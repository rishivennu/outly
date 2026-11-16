/**
 * R1177: Whisper on Groq is the default transcription engine when GROQ_API_KEY is set; Gemini takes any part
 * Whisper could not (an error, a 429 bench, times that don't line up). Every network call is stubbed here:
 * nothing reaches api.groq.com or Google for real.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.GROQ_API_KEY = "test";

let env: typeof import("../lib/env").env;
let transcribe: typeof import("../lib/ai/transcribe");
let availability: typeof import("../lib/captions/availability");
let languages: typeof import("../lib/captions/languages");

const realFetch = globalThis.fetch;
const realWarn = console.warn;
const realInfo = console.info;
let saved: { groq: string; gemini: string };
type Sent = { url: string; init?: RequestInit };
let sent: Sent[] = [];

const wav = new ArrayBuffer(64);
const groqWords = (words: { word: string; start: number; end: number }[], language = "English") =>
  Response.json({ text: words.map((w) => w.word).join(" "), language, duration: 30, words });
const geminiAnswer = (words: { w: string; s: number; e: number }[]) =>
  Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ language: "en", words }) }] } }] });

function stub(groq: (init?: RequestInit) => Response | Promise<Response>, gemini: () => Response = () => geminiAnswer([{ w: "from", s: 0.1, e: 0.4 }, { w: "gemini.", s: 0.5, e: 0.9 }])) {
  sent = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    sent.push({ url: u, init });
    if (u.includes("api.groq.com")) return groq(init);
    if (u.includes("generativelanguage")) return gemini();
    throw new Error(`unexpected fetch ${u}`);
  }) as typeof fetch;
}
const groqCalls = () => sent.filter((x) => x.url.includes("api.groq.com")).length;
const geminiCalls = () => sent.filter((x) => x.url.includes("generativelanguage")).length;

beforeAll(async () => {
  ({ env } = await import("../lib/env"));
  saved = { groq: env.GROQ_API_KEY, gemini: env.GEMINI_API_KEY };
  transcribe = await import("../lib/ai/transcribe");
  availability = await import("../lib/captions/availability");
  languages = await import("../lib/captions/languages");
  console.warn = () => {};
  console.info = () => {};
}, 60_000);
afterEach(() => {
  globalThis.fetch = realFetch;
  (env as { GROQ_API_KEY: string }).GROQ_API_KEY = "test";
  (env as { GEMINI_API_KEY: string }).GEMINI_API_KEY = "";
  transcribe.resetWhisperBench();
});
afterAll(() => {
  (env as { GROQ_API_KEY: string }).GROQ_API_KEY = saved.groq;
  (env as { GEMINI_API_KEY: string }).GEMINI_API_KEY = saved.gemini;
  console.warn = realWarn;
  console.info = realInfo;
});

const setKeys = (groq: string, gemini: string) => {
  (env as { GROQ_API_KEY: string }).GROQ_API_KEY = groq;
  (env as { GEMINI_API_KEY: string }).GEMINI_API_KEY = gemini;
};

describe("R1177 Whisper on Groq", () => {
  test("builds the multipart request: bearer key, model, verbose_json, word timings, language only with a hint", async () => {
    setKeys("test", "");
    stub(() => groqWords([{ word: "hi", start: 0.1, end: 0.3 }]));
    await transcribe.transcribeWav(wav, 0, 30, { lang: "hi" });
    await transcribe.transcribeWav(wav, 0, 30, {});
    expect(sent.length).toBe(2);
    const [hinted, detect] = sent;
    expect(hinted.url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(new Headers(hinted.init?.headers).get("authorization")).toBe("Bearer test");
    const f = hinted.init?.body as FormData;
    expect(f.get("model")).toBe(env.GROQ_WHISPER_MODEL);
    expect(f.get("response_format")).toBe("verbose_json");
    expect(f.getAll("timestamp_granularities[]")).toEqual(["word"]);
    expect(f.get("temperature")).toBe("0");
    expect(f.get("language")).toBe("hi");
    const file = f.get("file") as File;
    expect(file.name).toBe("chunk.wav");
    expect(file.type).toBe("audio/wav");
    expect((detect.init?.body as FormData).has("language")).toBe(false);
  });

  test("hotwords become the spelling prompt, capped at 200 characters; none = no prompt", async () => {
    const { DEFAULT_SUBTITLE_RULES } = await import("../lib/captions/subtitle-engine");
    const store = await import("../lib/ai/engine-store");
    setKeys("test", "");
    stub(() => groqWords([{ word: "hi", start: 0.1, end: 0.3 }]));
    try {
      const hot = ["Outlly", "Rishi", ...Array.from({ length: 30 }, (_, i) => `Name${i}`)];
      const saved = await store.saveSubtitleRules({ ...DEFAULT_SUBTITLE_RULES, hotwords: hot });
      await transcribe.transcribeWav(wav, 0, 30, {});
      const prompt = String((sent[0].init?.body as FormData).get("prompt"));
      expect(prompt).toBe(saved.hotwords.join(", ").slice(0, 200));
      expect(prompt.startsWith("Outlly, Rishi")).toBe(true);
      expect(prompt.length).toBeLessThanOrEqual(200);
      await store.saveSubtitleRules({ ...DEFAULT_SUBTITLE_RULES, hotwords: [] });
      sent = [];
      await transcribe.transcribeWav(wav, 0, 30, {});
      expect((sent[0].init?.body as FormData).has("prompt")).toBe(false);
    } finally {
      await store.saveSubtitleRules(DEFAULT_SUBTITLE_RULES);
    }
  });

  test("maps a verbose_json answer at offset 60: offsets applied, cues built, language from the name", async () => {
    setKeys("test", "");
    stub(() => groqWords([{ word: " Hello", start: 0.2, end: 0.6 }, { word: " there", start: 0.7, end: 1.0 }, { word: " friends", start: 1.1, end: 1.6 }]));
    const t = await transcribe.transcribeWav(wav, 60, 30, {});
    expect(t.engine).toBe("whisper");
    expect(t.language).toBe("en");
    expect(t.words).toEqual([{ w: "Hello", s: 60.2, e: 60.6 }, { w: "there", s: 60.7, e: 61 }, { w: "friends", s: 61.1, e: 61.6 }]);
    expect(t.cues.length).toBeGreaterThan(0);
    expect(t.cues[0].start).toBe(60.2);
    expect(t.cues.map((c) => c.text).join(" ")).toBe("Hello there friends");
    expect(t.lines.maxChars).toBeGreaterThan(0);
  });

  test("silence is a valid answer: no words, no cues, still Whisper", async () => {
    setKeys("test", "k");
    stub(() => Response.json({ text: "", language: "english", duration: 30, words: [] }));
    const t = await transcribe.transcribeWav(wav, 0, 30, {});
    expect(t).toMatchObject({ words: [], cues: [], engine: "whisper", language: "en" });
    expect(geminiCalls()).toBe(0);
  });

  test("a 429 with retry-after falls to Gemini and benches Groq for the next parts", async () => {
    setKeys("test", "k");
    stub(() => new Response("slow down", { status: 429, headers: { "retry-after": "30" } }));
    const first = await transcribe.transcribeWav(wav, 0, 30, {});
    expect(first.engine).toBe("gemini");
    expect(groqCalls()).toBe(1);
    expect(geminiCalls()).toBe(1);
    expect(transcribe.whisperBenched()).toBe(true);
    expect(transcribe.whisperBenched(Date.now() + 31_000)).toBe(false);
    const second = await transcribe.transcribeWav(wav, 60, 30, {});
    expect(second.engine).toBe("gemini");
    expect(groqCalls()).toBe(1);
  });

  test("a 5xx without retry-after benches for a minute", async () => {
    setKeys("test", "k");
    stub(() => new Response("down", { status: 503 }));
    await transcribe.transcribeWav(wav, 0, 30, {});
    expect(transcribe.whisperBenched(Date.now() + 55_000)).toBe(true);
    expect(transcribe.whisperBenched(Date.now() + 61_000)).toBe(false);
  });

  test("a benched Groq with no Gemini key says busy (429) instead of claiming no engine", async () => {
    setKeys("test", "");
    stub(() => new Response("slow down", { status: 429, headers: { "retry-after": "5" } }));
    const err = await transcribe.transcribeWav(wav, 0, 30, {}).catch((e) => e);
    expect(err.status).toBe(429);
    expect(err.code).toBe("RATE_LIMITED");
  });

  test("the caller's abort is rethrown, a network error gets the Gemini result", async () => {
    setKeys("test", "k");
    const ctl = new AbortController();
    stub(() => {
      ctl.abort();
      throw new DOMException("aborted", "AbortError");
    });
    const err = await transcribe.transcribeWav(wav, 0, 30, { signal: ctl.signal }).catch((e) => e);
    expect(err.name).toBe("AbortError");
    expect(geminiCalls()).toBe(0);

    stub(() => {
      throw new TypeError("fetch failed");
    });
    const t = await transcribe.transcribeWav(wav, 0, 30, {});
    expect(t.engine).toBe("gemini");
    expect(t.words.map((w) => w.w)).toEqual(["from", "gemini."]);
    expect(transcribe.whisperBenched()).toBe(false);
  });

  test("times that fail the chunk check are refused and Gemini answers", async () => {
    setKeys("test", "k");
    // Ten words on one instant: the same "many words share one time" refusal Gemini answers get.
    stub(() => groqWords(Array.from({ length: 10 }, (_, i) => ({ word: `w${i}`, start: 3, end: 3.2 }))));
    const t = await transcribe.transcribeWav(wav, 0, 10, {});
    expect(groqCalls()).toBe(1);
    expect(t.engine).toBe("gemini");
  });

  test("no keys at all: 503 NO_AI before any call", async () => {
    setKeys("", "");
    stub(() => groqWords([]));
    const err = await transcribe.transcribeWav(wav, 0, 30, {}).catch((e) => e);
    expect(err.status).toBe(503);
    expect(err.code).toBe("NO_AI");
    expect(sent.length).toBe(0);
  });

  test("transcription is configured with only a Groq key", () => {
    expect(availability.transcriptionConfigured({ geminiKey: "", groqKey: "g", provider: "gemini", workerUrl: "", funasrUrl: "" })).toBe(true);
    expect(availability.transcriptionConfigured({ geminiKey: "", groqKey: "", provider: "gemini", workerUrl: "", funasrUrl: "" })).toBe(false);
  });

  test("Whisper language names map to codes", () => {
    expect(languages.langCodeFromName("English")).toBe("en");
    expect(languages.langCodeFromName("hindi")).toBe("hi");
    expect(languages.langCodeFromName("Vietnamese")).toBe("vi");
    expect(languages.langCodeFromName("te")).toBe("te");
    expect(languages.langCodeFromName("klingon")).toBe("");
    expect(languages.langCodeFromName(undefined)).toBe("");
  });

  test("no em dash, en dash or emoji in the R1177 Part A files", () => {
    const root = join(import.meta.dir, "..");
    const files = ["lib/ai/transcribe.ts", "lib/captions/availability.ts", "lib/captions/languages.ts", "components/admin/AiEngineCard.tsx", "app/admin/(panel)/integrations/page.tsx", "tests/round-1177-whisper.test.ts"];
    for (const f of files) {
      const src = readFileSync(join(root, f), "utf8");
      expect({ f, bad: /[\u2013\u2014]|\p{Extended_Pictographic}/u.test(src) }).toEqual({ f, bad: false });
    }
  });
});
