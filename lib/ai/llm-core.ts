/**
 * Model router core (1053): pure, so it is unit tested. Which model to ask first (the fastest that is
 * working), how to read each provider's stream, and how to pull finished items out of half-written JSON.
 */

export type Provider = "gemini" | "kimi";
export type ModelId = { provider: Provider; model: string };

/** Rolling speed and health of one model, kept in memory per server instance. */
export type ModelStat = { ewmaMs: number; fails: number; benchedUntil: number; samples: number };

export const HEDGE_MS = 2_500; // no text from the first model by now: start the next one alongside it
export const BENCH_MS = 10 * 60_000; // a model out of credit or broken sits out this long
export const SLOW_BENCH_MS = 90_000; // a timeout or 5xx sits out less: usually a passing blip

/** Default speed guesses before anything is measured (from the 10-30 benchmark). */
const PRIOR_MS: Record<string, number> = { "gemini-flash-lite-latest": 1_700, "gemini-3.5-flash-lite": 2_000, "kimi-k2.6": 3_000, "gemini-3.6-flash": 3_500 };

export const keyOf = (m: ModelId) => `${m.provider}:${m.model}`;

export function freshStat(m: ModelId): ModelStat {
  return { ewmaMs: PRIOR_MS[m.model] ?? 4_000, fails: 0, benchedUntil: 0, samples: 0 };
}

/** A good answer: fold its time into the average (recent calls count most) and clear the failures. */
export function recordOk(s: ModelStat, ms: number): ModelStat {
  const a = s.samples < 3 ? 0.5 : 0.3;
  return { ewmaMs: Math.round(s.ewmaMs * (1 - a) + ms * a), fails: 0, benchedUntil: 0, samples: s.samples + 1 };
}

/** A failure. `hard` (no credit, bad key, model gone) benches it for long; a blip benches it briefly after two in a row. */
export function recordFail(s: ModelStat, now: number, hard: boolean): ModelStat {
  const fails = s.fails + 1;
  const benchedUntil = hard ? now + BENCH_MS : fails >= 2 ? now + SLOW_BENCH_MS : s.benchedUntil;
  return { ...s, fails, benchedUntil, ewmaMs: s.ewmaMs + 1_000 };
}

/** HTTP statuses that mean "this model won't work for a while": quota/credit, auth, gone. */
export const isHardFailure = (status: number, body = "") => status === 401 || status === 403 || status === 404 || (status === 429 && /balance|suspend|quota|billing|exceed/i.test(body));

/**
 * The order to try models in: working ones fastest first, benched ones last (still tried if nothing
 * else answers). A model that already exists in `stats` keeps its measured speed.
 */
export function rank(models: ModelId[], stats: Map<string, ModelStat>, now: number): ModelId[] {
  const s = (m: ModelId) => stats.get(keyOf(m)) ?? freshStat(m);
  return [...models].sort((a, b) => {
    const ba = s(a).benchedUntil > now ? 1 : 0;
    const bb = s(b).benchedUntil > now ? 1 : 0;
    return ba - bb || s(a).ewmaMs - s(b).ewmaMs;
  });
}

/** Splits an SSE body into its `data:` payloads (both providers stream SSE). Returns the payloads and the unfinished tail. */
export function sseEvents(buf: string): { events: string[]; rest: string } {
  const parts = buf.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  const events = parts.flatMap((p) => p.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim())).filter((d) => d && d !== "[DONE]");
  return { events, rest };
}

/** The text delta inside one streamed event, whichever provider sent it. */
export function deltaText(provider: Provider, data: string): string {
  try {
    const j = JSON.parse(data);
    if (provider === "gemini") return (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string; thought?: boolean }) => (p.thought ? "" : p.text ?? "")).join("");
    return j.choices?.[0]?.delta?.content ?? "";
  } catch {
    return "";
  }
}

/** The text of a whole, non-streamed answer (a proxy or a mock that ignores ?alt=sse / stream:true). */
export function wholeText(provider: Provider, body: string): string {
  try {
    const j = JSON.parse(body);
    const items = Array.isArray(j) ? j : [j]; // Gemini without alt=sse answers with an array of chunks
    if (provider === "gemini") return items.map((x) => deltaText(provider, JSON.stringify(x))).join("");
    return items.map((x) => x?.choices?.[0]?.message?.content ?? x?.choices?.[0]?.delta?.content ?? "").join("");
  } catch {
    return "";
  }
}

/**
 * Finished objects inside the array `key` of a JSON document that is still being written, e.g. the
 * hooks that are complete while the third one streams. Strings and escapes are respected, so a brace
 * inside a caption never confuses it.
 */
export function partialArray<T = Record<string, unknown>>(text: string, key: string): T[] {
  // Models sometimes drop the wrapper and send the bare array: read that the same way.
  const m = new RegExp(`"${key}"\\s*:\\s*\\[`).exec(text) ?? /^\s*\[/.exec(text);
  if (!m) return [];
  const out: T[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = m.index + m[0].length; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(text.slice(start, i + 1)) as T);
        } catch {
          /* skip a malformed item */
        }
        start = -1;
      }
    } else if (c === "]" && depth === 0) break;
  }
  return out;
}

/** A finished top-level string field (e.g. "understood") from JSON still being written, or null. */
export function partialString(text: string, key: string): string | null {
  const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return null;
  }
}

/** Models sometimes wrap JSON in ``` fences or add a sentence first: keep the outermost object. */
export function cleanJson(text: string): string {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const arr = t.startsWith("[");
  const a = t.indexOf(arr ? "[" : "{");
  const b = t.lastIndexOf(arr ? "]" : "}");
  return a >= 0 && b > a ? t.slice(a, b + 1) : t;
}
