import "server-only";
import { env } from "../env";
import { HttpError } from "../http";
import { normalizeCues, type Cue } from "../captions/cues";
import { cleanWords, cuesFromWords, wordsFromCues, wordsFromFunasr, type SubtitleRules, type Word } from "../captions/subtitle-engine";
import { subtitleRules } from "./engine-store";
import { assertPublicUrl } from "../net/assert-public";

// gemini-flash-latest stopped answering (30 s+ timeouts, 10-30 benchmark), so it no longer goes first.
const MODELS = ["gemini-3.6-flash", "gemini-flash-lite-latest"];

const prompt = (rules: SubtitleRules) => `Transcribe the speech in this audio word by word, for on-screen video subtitles.
Return JSON {"language": BCP-47 code, "words": [{"w": "word", "s": start seconds, "e": end seconds}]}.
Rules: keep the speaker's exact words and language (do not translate); write punctuation as people would read it and attach it to the word before it (so "Hello," and "today."); drop only filler like "um"; times in seconds from the start of THIS audio, as numbers with two decimals, one entry per spoken word (for Chinese or Japanese, one per character); nothing for music or silence.${rules.hotwords.length ? ` These names may come up, spell them exactly: ${rules.hotwords.join(", ")}.` : ""} If nobody speaks, return {"language":"", "words": []}.`;

export type Transcript = { cues: Cue[]; words: Word[]; language: string; engine: "gemini" | "funasr" };

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
  return { words, cues: cuesFromWords(words, rules), language: String(j?.language ?? j?.[0]?.language ?? ""), engine: "funasr" };
}

async function viaGemini(wav: ArrayBuffer, offset: number, duration: number, rules: SubtitleRules): Promise<Transcript> {
  if (!env.GEMINI_API_KEY) throw new HttpError(503, "AI transcription needs a Gemini API key on the server. You can still type or paste your captions.", "NO_AI");
  const data = Buffer.from(wav).toString("base64");
  let lastErr = "";
  for (const model of MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ inline_data: { mime_type: "audio/wav", data } }, { text: prompt(rules) }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
        }),
        signal: AbortSignal.timeout(40_000),
      });
      if (!r.ok) {
        lastErr = `${model} ${r.status}`;
        continue;
      }
      const j = await r.json();
      const txt: string | undefined = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("");
      if (!txt) continue;
      const parsed = JSON.parse(txt.replace(/^```(?:json)?|```$/g, "").trim());
      const language = String(parsed.language ?? "");
      // Word timings when the model gives them; older answers in cue form still work.
      let words = cleanWords(parsed.words, offset, offset + duration);
      if (!words.length && (Array.isArray(parsed) || Array.isArray(parsed.cues))) words = wordsFromCues(normalizeCues(Array.isArray(parsed) ? parsed : parsed.cues, offset + duration, offset));
      return { words, cues: cuesFromWords(words, rules), language, engine: "gemini" };
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  throw new HttpError(502, `Transcription didn't come back (${lastErr || "no answer"}). Try again, or type your captions.`, "AI_FAILED");
}

/** One chunk of 16 kHz mono WAV -> word timings and subtitle lines, offset to where the chunk sits in the video.
 * The FunASR worker is used when it is switched on; if it is down, Gemini answers instead. */
export async function transcribeWav(wav: ArrayBuffer, offset: number, duration: number): Promise<Transcript> {
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
  return viaGemini(wav, offset, duration, rules);
}
