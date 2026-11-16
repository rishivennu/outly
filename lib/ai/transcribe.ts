import "server-only";
import { env } from "../env";
import { HttpError } from "../http";
import { normalizeCues, type Cue } from "../captions/cues";
import { cleanWords, cuesFromWords, wordsFromCues, wordsFromFunasr, type SubtitleRules, type Word } from "../captions/subtitle-engine";
import { buildCues, checkChunkWords } from "../captions/timing";
import { langCodeFromName, languageName, normalizeLang } from "../captions/languages";
import { subtitleRules } from "./engine-store";
import { assertPublicUrl } from "../net/assert-public";
import { db } from "../db";
import { chargeAi } from "../ai-quota";
import { recordCost } from "../subscriptions/costs";
import { CHUNKS_PER_CAPTION_VIDEO } from "../billing/entitlements";
import { hedgeAfterMs, hedged, type TryResult } from "../captions/hedge";

/**
 * Benchmark 11-16 (en, hi, te, ta, kn, bn and mixed te-en, TTS with known word times): 3.1-flash-lite answers a
 * 50 s part in 7-14 s with WER and word timing as good as or better than 3.6-flash, which spends 3-4k thinking
 * tokens and takes 25-34 s. flash-lite-latest and 3.5-flash-lite now return times that jump or bunch up, and
 * 3.7/3.8-flash time out at 45 s. gemini-flash-latest is never used (30 s+ timeouts, 10-30 benchmark).
 */
const PRIMARY = "gemini-3.1-flash-lite";
/** After a failed try (an error, or times that can't be trusted), a different model gets the audio. */
const FALLBACKS = ["gemini-3.6-flash", PRIMARY];
/** Every try together must fit the route's 60 s maxDuration, counted from when the request came in. */
const BUDGET_MS = 52_000;
/** 3.6-flash thinks for 25-34 s on a 60 s part, so it is only worth starting with this much time left. */
const minLeftFor = (model: string) => (model === PRIMARY ? 8_000 : 30_000);

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    language: { type: "STRING" },
    words: { type: "ARRAY", items: { type: "OBJECT", properties: { w: { type: "STRING" }, s: { type: "NUMBER" }, e: { type: "NUMBER" } }, required: ["w", "s", "e"] } },
  },
  required: ["language", "words"],
};

export const transcribePrompt = (rules: SubtitleRules, duration: number, lang = "") => `Transcribe the speech in this audio word by word, for on-screen video subtitles.
Return JSON {"language": BCP-47 code of the main spoken language, "words": [{"w": "word", "s": start seconds, "e": end seconds}]}.
Rules: keep the speaker's exact words and language (do not translate); write each language in its own script (Telugu in Telugu script, Tamil in Tamil script, Hindi in Devanagari), and English words the speaker mixes in stay in English; write punctuation as people would read it and attach it to the word before it (so "Hello," and "today."); drop only filler like "um"; one entry per spoken word (for Chinese or Japanese, one per character); nothing for music or silence.
Timing: this audio is ${duration.toFixed(2)} seconds long. s and e are seconds (not milliseconds) from the start of THIS audio, as numbers with two decimals, between 0 and ${duration.toFixed(2)}, in the order spoken. s is when the word starts being heard, e when it stops; leave pauses as gaps between words.${lang ? ` The speaker talks mainly in ${languageName(lang)} (${lang}).` : ""}${rules.hotwords.length ? ` These names may come up, spell them exactly: ${rules.hotwords.join(", ")}.` : ""} If nobody speaks, return {"language":"", "words": []}. A word the speaker says in English is written in English letters, whatever language the rest of the speech is in ("video", not "వీడియో", "ビデオ" or "видео"); the same goes for any other language mixed into the speech: write each word in its own script, never transliterated into the main language's script.`;

/** The line rules the editor needs to rebuild whole-video lines from the stitched words. */
export type LineRules = Pick<SubtitleRules, "maxChars" | "maxWords" | "minCue" | "maxCue" | "pause">;
export type Transcript = { cues: Cue[]; words: Word[]; language: string; engine: "gemini" | "funasr" | "whisper"; lines: LineRules };

const lineRules = (r: SubtitleRules): LineRules => ({ maxChars: r.maxChars, maxWords: r.maxWords, minCue: r.minCue, maxCue: r.maxCue, pause: r.pause });

/** FunClip's own engine: a FunASR worker (Paraformer + VAD + punctuation) behind FUNASR_URL or the admin setting. */
async function viaFunasr(url: string, wav: ArrayBuffer, offset: number, duration: number, rules: SubtitleRules): Promise<Transcript | null> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "audio/wav", ...(env.FUNASR_TOKEN ? { authorization: `Bearer ${env.FUNASR_TOKEN}` } : {}), ...(rules.hotwords.length ? { "x-hotwords": rules.hotwords.join(" ").slice(0, 400) } : {}) },
    body: wav,
    redirect: "error",
    signal: AbortSignal.timeout(50_000),
  });
  if (!r.ok) return null;
  const j = await r.json();
  const words = wordsFromFunasr(j, offset, offset + duration);
  return { words, cues: cuesFromWords(words, rules), language: normalizeLang(j?.language ?? j?.[0]?.language ?? ""), engine: "funasr", lines: lineRules(rules) };
}

const WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
/** Whisper answers a 30 s part in about half a second, so a slow one is a stuck one: Gemini gets the rest of the time. */
const WHISPER_TIMEOUT_MS = 20_000;
/** R1177: after a 429 or a 5xx, Groq is skipped until then. Parts arrive every few seconds, and each one
 * should not pay a round trip to a service that just said no. */
let whisperBenchedUntil = 0;

export const whisperBenched = (now = Date.now()) => now < whisperBenchedUntil;
/** Tests only: forget a bench left by an earlier case. */
export const resetWhisperBench = () => void (whisperBenchedUntil = 0);

/**
 * R1177: Whisper on Groq (whisper-large-v3-turbo), the default when GROQ_API_KEY is set. Measured 11-16: a 30 s
 * part in 0.55 s with word timings from the model's own decoder, against 9.6 s on Gemini. Without a language hint
 * Hindi came back in Urdu script, so the creator's pick is always passed on. null = let Gemini answer this part.
 */
async function viaWhisper(wav: ArrayBuffer, offset: number, duration: number, rules: SubtitleRules, lang: string, signal?: AbortSignal, deadline?: number): Promise<Transcript | null> {
  const left = Math.min(WHISPER_TIMEOUT_MS, (deadline ?? Infinity) - Date.now() - 1_000);
  if (!(left > 1_000)) return null;
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), "chunk.wav");
  form.append("model", env.GROQ_WHISPER_MODEL || "whisper-large-v3-turbo");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("temperature", "0");
  if (lang) form.append("language", lang.split("-")[0]);
  // Whisper reads the prompt as text said before this audio, which nudges it to spell these names the same way.
  if (rules.hotwords.length) form.append("prompt", rules.hotwords.join(", ").slice(0, 200));
  let r: Response;
  try {
    r = await fetch(WHISPER_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: form,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(left)]) : AbortSignal.timeout(left),
    });
  } catch (e) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    console.warn(`[transcribe] whisper at ${offset}s: ${(e as Error).message}`);
    return null;
  }
  if (!r.ok) {
    console.warn(`[transcribe] whisper ${r.status}`);
    if (r.status === 429 || r.status >= 500) {
      const after = Number(r.headers.get("retry-after"));
      whisperBenchedUntil = Date.now() + (Number.isFinite(after) && after > 0 ? after * 1000 : 60_000);
    }
    return null;
  }
  let j: { text?: unknown; language?: unknown; words?: unknown };
  try {
    j = await r.json();
  } catch {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    console.warn(`[transcribe] whisper at ${offset}s: unreadable answer`);
    return null;
  }
  const language = normalizeLang(langCodeFromName(j?.language)) || lang;
  const raw = Array.isArray(j?.words) ? j.words : [];
  // Silence (nothing said in this part) is a real answer, the same empty part Gemini gives back.
  if (!raw.length && !String(j?.text ?? "").trim()) return { words: [], cues: [], language, engine: "whisper", lines: lineRules(rules) };
  const t = checkChunkWords(raw, duration, offset);
  if (!t.ok) {
    console.warn(`[transcribe] whisper at ${offset}s: ${t.reason}`);
    return null;
  }
  const words = cleanWords(t.words, offset, offset + duration);
  if (!words.length) {
    console.warn(`[transcribe] whisper at ${offset}s: text but no word timings`);
    return null;
  }
  return { words, cues: buildCues(words, rules, offset + duration), language, engine: "whisper", lines: lineRules(rules) };
}

/** One model answer -> words on the video timeline, or the reason its times can't be trusted. */
export function readGeminiAnswer(parsed: unknown, offset: number, duration: number): { ok: true; words: Word[]; language: string } | { ok: false; reason: string } {
  const p = (parsed ?? {}) as Record<string, unknown>;
  const language = normalizeLang(p.language);
  if (Array.isArray(p.words)) {
    const t = checkChunkWords(p.words, duration, offset);
    if (!t.ok) return t;
    return { ok: true, words: cleanWords(t.words, offset, offset + duration), language };
  }
  // Older answers in cue form still work.
  if (Array.isArray(parsed) || Array.isArray(p.cues)) {
    const cues = normalizeCues((Array.isArray(parsed) ? parsed : p.cues) as { start: unknown; end: unknown; text: unknown }[], offset + duration, offset);
    return { ok: true, words: wordsFromCues(cues), language };
  }
  return { ok: false, reason: "no words in the answer" };
}

type Answer = { words: Word[]; language: string };

/** One try at one model: a usable answer, or why not (an HTTP error, an empty reply, times that don't line up). */
async function askGemini(model: string, data: string, prompt: string, offset: number, duration: number, signal: AbortSignal, timeoutMs: number): Promise<TryResult<Answer>> {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inline_data: { mime_type: "audio/wav", data } }, { text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, temperature: 0.1 },
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  });
  if (!r.ok) return { ok: false, reason: `${model} ${r.status}`, status: r.status };
  const j = await r.json();
  const txt: string | undefined = j.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
  if (!txt) return { ok: false, reason: `${model} empty` };
  const got = readGeminiAnswer(JSON.parse(txt.replace(/^```(?:json)?|```$/g, "").trim()), offset, duration);
  if (!got.ok) {
    console.warn(`[transcribe] ${model} at ${offset}s: ${got.reason}`);
    return { ok: false, reason: got.reason, badTiming: true };
  }
  return { ok: true, value: { words: got.words, language: got.language } };
}

async function viaGemini(wav: ArrayBuffer, offset: number, duration: number, rules: SubtitleRules, lang: string, signal?: AbortSignal, deadline?: number): Promise<Transcript> {
  if (!env.GEMINI_API_KEY) throw new HttpError(503, "AI transcription is not set up on this server. You can still type or paste your captions.", "NO_AI");
  const data = Buffer.from(wav).toString("base64");
  const prompt = transcribePrompt(rules, duration, lang);
  // The fast model first; a second try of it when the first is a straggler; another model when a try fails.
  const out = await hedged({
    primary: PRIMARY,
    fallbacks: FALLBACKS,
    hedgeMs: hedgeAfterMs(duration),
    budgetMs: Math.min(BUDGET_MS, (deadline ?? Infinity) - Date.now()),
    minLeftMs: minLeftFor,
    signal,
    attempt: (model, s, timeoutMs) => askGemini(model, data, prompt, offset, duration, s, timeoutMs),
  });
  if (out.ok) {
    // Stage timing for the logs: which model answered, after how many tries, how fast per audio second.
    console.info(`[transcribe] ${out.model} ${duration.toFixed(1)}s audio in ${out.ms} ms, ${out.tries} ${out.tries === 1 ? "try" : "tries"}`);
    return { words: out.value.words, cues: buildCues(out.value.words, rules, offset + duration), language: out.value.language || lang, engine: "gemini", lines: lineRules(rules) };
  }
  console.warn(`[transcribe] failed at ${offset}s after ${out.tries} tries, ${out.ms} ms: ${out.reason}`);
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  // The browser's runner waits and tries a 429 again by itself (Retry-After), so a busy model is not a failed part.
  if (out.rateLimited) throw new HttpError(429, "The transcription service is busy right now. Try again in a minute.", "RATE_LIMITED", { retryAfter: 8 });
  if (out.badTiming) throw new HttpError(502, "The timings for this part didn't line up, so we left it out rather than guess. Try this part again.", "BAD_TIMING");
  throw new HttpError(502, "This part didn't come back from transcription. Try it again, or type your captions.", "AI_FAILED");
}

/** One chunk of 16 kHz mono WAV -> word timings and subtitle lines, offset to where the chunk sits in the video.
 * The FunASR worker is used when it is switched on (off by default). Otherwise Whisper on Groq answers when
 * GROQ_API_KEY is set (R1177), and Gemini takes any part Whisper could not, or every part without a Groq key.
 * `lang` is the creator's pick for the spoken language, sent as a hint; empty = detect it. */
export async function transcribeWav(wav: ArrayBuffer, offset: number, duration: number, opts: { lang?: string; signal?: AbortSignal; deadline?: number } = {}): Promise<Transcript> {
  const rules = await subtitleRules();
  const url = rules.workerUrl || env.FUNASR_URL;
  if (rules.provider === "funasr" && url) {
    try {
      // FUNASR_URL is the operator's own (may be private); an admin-typed URL is re-checked before every call.
      if (rules.workerUrl && process.env.NODE_ENV === "production") await assertPublicUrl(rules.workerUrl);
      const t = await viaFunasr(url, wav, offset, duration, rules);
      if (t && (t.words.length || !env.GEMINI_API_KEY)) return t;
    } catch (e) {
      console.warn("[transcribe] FunASR worker failed, using Gemini:", (e as Error).message);
    }
  }
  const lang = normalizeLang(opts.lang);
  if (env.GROQ_API_KEY && !whisperBenched()) {
    const t = await viaWhisper(wav, offset, duration, rules, lang, opts.signal, opts.deadline);
    if (t) return t;
  }
  if (env.GROQ_API_KEY && !env.GEMINI_API_KEY) {
    // Whisper is the only engine and it said no: the browser retries a 429 by itself, so a benched Groq is "busy".
    if (whisperBenched()) throw new HttpError(429, "The transcription service is busy right now. Try again in a minute.", "RATE_LIMITED", { retryAfter: 8 });
    throw new HttpError(502, "This part didn't come back from transcription. Try it again, or type your captions.", "AI_FAILED");
  }
  return viaGemini(wav, offset, duration, rules, lang, opts.signal, opts.deadline);
}

/** A transcription run: one per "Transcribe" press, shared by its chunks and its retries for half an hour. */
export const RUN_FEATURE = "caption-run";
/** One row per distinct audio chunk (by content hash) a run has sent, so a run can't reuse its one charge forever. */
export const RUN_CHUNK_FEATURE = "caption-run-chunk";
export const RUN_TTL_MS = 30 * 60_000;
const RUN_RE = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Counts one AI request per run, not per chunk. The first chunk to arrive claims the run row and is charged;
 * later chunks and retries of the same video ref + run only add their real transcription minutes to the cost
 * meter. The claim lives in the database, so it holds across instances. A request without a run id (an older
 * client) is charged per chunk, as before. The per-chunk caption budget in assertCaptionVideo still meters audio.
 * `chunk` is the server's hash of this chunk's audio: a byte-identical resend is free, but every
 * CHUNKS_PER_CAPTION_VIDEO distinct chunks in one run cost one more request, so new audio is always metered.
 */
export async function chargeRun(userId: string, ref: string, run: string, duration: number, now = new Date(), chunk = "") {
  const meter = { category: "transcription" as const, units: duration / 60 };
  if (!RUN_RE.test(run)) return void (await chargeAi(userId, "ai", now, meter, "transcription"));
  const key = `${ref.slice(0, 80)}#${run}`;
  const charged = await claimRun(userId, key, meter, now);
  if (!chunk) {
    if (!charged) await recordCost({ userId, ...meter, now });
    return;
  }
  let row: string;
  try {
    row = (await db.featureUse.create({ data: { userId, feature: RUN_CHUNK_FEATURE, period: "run", ref: `${key}:${chunk}` }, select: { id: true } })).id;
  } catch (err) {
    // The same audio again (a lost answer, a retry): already counted. Anything else must not pass silently.
    if ((err as { code?: string } | null)?.code !== "P2002") throw err;
    if (!charged) await recordCost({ userId, ...meter, now });
    return;
  }
  if (charged) return;
  const distinct = await db.featureUse.count({ where: { userId, feature: RUN_CHUNK_FEATURE, period: "run", ref: { startsWith: `${key}:` } } });
  if (distinct <= CHUNKS_PER_CAPTION_VIDEO || (distinct - 1) % CHUNKS_PER_CAPTION_VIDEO !== 0) {
    await recordCost({ userId, ...meter, now });
    return;
  }
  try {
    await chargeAi(userId, "ai", now, meter, "transcription");
  } catch (e) {
    await db.featureUse.deleteMany({ where: { id: row } });
    throw e;
  }
}

/** Claims the run for this request and charges it; false when the run was already charged within RUN_TTL_MS. */
async function claimRun(userId: string, key: string, meter: { category: "transcription"; units: number }, now: Date) {
  const seen = await db.featureUse.findFirst({ where: { userId, feature: RUN_FEATURE, period: "run", ref: key }, select: { id: true, createdAt: true } });
  if (seen && now.getTime() - seen.createdAt.getTime() < RUN_TTL_MS) return false;
  let claimed: string | null = null;
  if (seen) await db.featureUse.update({ where: { id: seen.id }, data: { createdAt: now } });
  else {
    try {
      claimed = (await db.featureUse.create({ data: { userId, feature: RUN_FEATURE, period: "run", ref: key }, select: { id: true } })).id;
    } catch {
      // Another chunk of this run claimed it a moment ago.
      return false;
    }
  }
  try {
    await chargeAi(userId, "ai", now, meter, "transcription");
  } catch (e) {
    // Refused (limit, budget): the run was not charged, so the next try must be.
    if (claimed) await db.featureUse.deleteMany({ where: { id: claimed } });
    else if (seen) await db.featureUse.update({ where: { id: seen.id }, data: { createdAt: seen.createdAt } }).catch(() => {});
    throw e;
  }
  return true;
}
