import "server-only";
import { env } from "../env";
import { HttpError } from "../http";
import type { Cue } from "../captions/cues";
import { applyTranslation, batchIds, readAnswer, translatePrompt, TRANSLATE_SCHEMA, TRANSLATE_SYSTEM, type Batch } from "../captions/translate-core";

/**
 * Caption translation engines. Gemini is the default and, for now, the only one. Another engine plugs in as one
 * more entry in ENGINES; the route and the editor only ever call translateCues().
 */
export type TranslationEngine = "gemini";
export const DEFAULT_TRANSLATION_ENGINE: TranslationEngine = "gemini";

type EngineCall = (system: string, prompt: string, signal: AbortSignal) => Promise<unknown | null>;

const GEMINI_MODELS = ["gemini-3.6-flash", "gemini-flash-lite-latest"];

const viaGemini: EngineCall = async (system, prompt, signal) => {
  for (const model of GEMINI_MODELS) {
    if (signal.aborted) return null;
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema: TRANSLATE_SCHEMA, temperature: 0.3 },
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
      });
      if (!r.ok) {
        console.warn(`[translate] ${model} ${r.status}`);
        continue;
      }
      const j = await r.json();
      const txt: string = j.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
      if (!txt.trim()) continue;
      return JSON.parse(txt.replace(/^```(?:json)?|```$/g, "").trim());
    } catch (e) {
      if (signal.aborted) return null;
      console.warn(`[translate] ${model}`, (e as Error).message);
    }
  }
  return null;
};

const ENGINES: Record<TranslationEngine, { ready: () => boolean; call: EngineCall }> = {
  gemini: { ready: () => !!env.GEMINI_API_KEY, call: viaGemini },
};

export const translationReady = (engine: TranslationEngine = DEFAULT_TRANSLATION_ENGINE) => ENGINES[engine].ready();

/** The whole run must fit the route's 60 s: no new batch starts after this. */
const BUDGET_MS = 45_000;
const LANES = 3;

/**
 * Cues -> English cues, one for one, same start and end. Each batch is asked once more for any ids it left out;
 * lines still missing keep their source text and are listed in `untranslated` (never invented).
 */
export async function translateCues(
  cues: Cue[],
  from: string,
  opts: { only?: number[]; engine?: TranslationEngine; signal?: AbortSignal; budgetMs?: number } = {},
): Promise<{ cues: Cue[]; untranslated: number[]; engine: TranslationEngine }> {
  const engine = opts.engine ?? DEFAULT_TRANSLATION_ENGINE;
  const e = ENGINES[engine];
  if (!e.ready()) throw new HttpError(503, "Translation needs a Gemini API key on the server.", "NO_AI");
  const signal = opts.signal ?? new AbortController().signal;
  const stopAt = Date.now() + (opts.budgetMs ?? BUDGET_MS);
  const texts = new Map<number, string>();
  const queue = batchIds(cues.length, opts.only);
  const runBatch = async (b: Batch) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ids = b.ids.filter((i) => !texts.has(i));
      if (!ids.length || signal.aborted || Date.now() > stopAt) return;
      const raw = await e.call(TRANSLATE_SYSTEM, translatePrompt(cues, { ...b, ids }, from), signal);
      if (raw) for (const [i, t] of readAnswer(raw, cues, ids, from)) texts.set(i, t);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(LANES, queue.length) }, async () => {
      while (queue.length && !signal.aborted && Date.now() <= stopAt) await runBatch(queue.shift()!);
    }),
  );
  const out = applyTranslation(cues, texts);
  const asked = new Set(batchIds(cues.length, opts.only).flatMap((b) => b.ids));
  return { cues: out.cues, untranslated: out.untranslated.filter((i) => asked.has(i)), engine };
}
