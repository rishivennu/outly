import "server-only";
import { createHash } from "node:crypto";
import { env } from "../env";
import { HEDGE_MS, deltaText, wholeText, freshStat, isHardFailure, keyOf, rank, recordFail, recordOk, sseEvents, type ModelId, type ModelStat } from "./llm-core";

/**
 * Every text model call goes through here (1053). Before, one fixed order was tried one after another, and
 * the fallback (gemini-flash-latest) hung until its 15 s timeout, so any blip on the first model cost 15 s+.
 * Now: the fastest working model goes first (measured, per instance); if it shows no text within HEDGE_MS the
 * next starts alongside it and whichever writes first wins, the other is cancelled. Kimi (Moonshot) joins
 * when KIMI_API_KEY is set. A model out of credit, unauthorised or gone sits out for a while.
 */

const GEMINI_DEFAULT = ["gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-3.6-flash"];
// gemini-flash-latest stopped answering (30 s timeouts, 10-30 benchmark); callers that ask for it get 3.6 Flash.
const ALIAS: Record<string, string> = { "gemini-flash-latest": "gemini-3.6-flash" };
const KIMI_MODEL = "kimi-k2.6";
const KIMI_URL = "https://api.moonshot.ai/v1/chat/completions";

const stats = new Map<string, ModelStat>();
export const modelStats = () => Object.fromEntries(stats);

export type LlmOpts = {
  temperature?: number;
  timeoutMs?: number;
  /** Gemini models to use, best first. Kimi is always added last when it has a key. */
  models?: string[];
  json?: boolean;
  /** The whole text so far from the model currently writing (it can restart shorter if that model fails). */
  onText?: (text: string) => void;
  /** Reuse an identical answer for a few minutes (pass something unique to the caller, e.g. the user id). */
  cacheKey?: string;
  /** The caller went away (closed the tab, asked again): stop every model at once. */
  signal?: AbortSignal;
};

function candidates(opts: LlmOpts): ModelId[] {
  const g = (opts.models?.length ? opts.models : GEMINI_DEFAULT).map((m) => ALIAS[m] ?? m);
  const list: ModelId[] = env.GEMINI_API_KEY ? [...new Set(g)].map((model) => ({ provider: "gemini" as const, model })) : [];
  if (env.KIMI_API_KEY) list.push({ provider: "kimi", model: KIMI_MODEL });
  return list;
}

class CallError extends Error {
  constructor(public status: number, public body: string) {
    super(`HTTP ${status}`);
  }
}

async function call(m: ModelId, system: string, prompt: string, opts: LlmOpts, signal: AbortSignal, onDelta: (full: string) => void): Promise<string> {
  const req: { url: string; headers: Record<string, string>; body: unknown } =
    m.provider === "gemini"
      ? {
          url: `https://generativelanguage.googleapis.com/v1beta/models/${m.model}:streamGenerateContent?alt=sse`,
          headers: { "x-goog-api-key": env.GEMINI_API_KEY },
          body: {
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { ...(opts.json !== false ? { responseMimeType: "application/json" } : {}), temperature: opts.temperature ?? 0.9 },
          },
        }
      : {
          url: KIMI_URL,
          headers: { authorization: `Bearer ${env.KIMI_API_KEY}` },
          body: {
            model: m.model,
            stream: true,
            ...(opts.json !== false ? { response_format: { type: "json_object" } } : {}),
            messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
          },
        };
  const r = await fetch(req.url, { method: "POST", headers: { "content-type": "application/json", ...req.headers }, body: JSON.stringify(req.body), signal });
  if (!r.ok || !r.body) throw new CallError(r.status, (await r.text().catch(() => "")).slice(0, 400));
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let raw = ""; // kept only while nothing has streamed, for an answer that arrives as one plain JSON body
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = dec.decode(value, { stream: true });
    buf += chunk;
    if (!text && raw.length < 2_000_000) raw += chunk;
    const { events, rest } = sseEvents(buf);
    buf = rest;
    let grew = false;
    for (const e of events) {
      const d = deltaText(m.provider, e);
      if (d) (text += d), (grew = true);
    }
    if (grew) onDelta(text);
  }
  for (const e of sseEvents(buf + "\n\n").events) text += deltaText(m.provider, e);
  if (!text.trim() && raw.trimStart().match(/^[[{]/)) {
    text = wholeText(m.provider, raw);
    if (text.trim()) onDelta(text); // so the race sees this model wrote, like a streamed answer
  }
  if (!text.trim()) throw new CallError(204, "empty");
  return text;
}

const cache = new Map<string, { at: number; text: string; model: string }>();
const CACHE_MS = 10 * 60_000;
const cacheId = (k: string, system: string, prompt: string, t: number | undefined) => createHash("sha256").update(`${k}\u0000${t}\u0000${system}\u0000${prompt}`).digest("base64url");

/** The raw text of the fastest good answer, or null when nothing answered in time. */
export async function llmText(system: string, prompt: string, opts: LlmOpts = {}): Promise<{ text: string; model: string } | null> {
  const id = opts.cacheKey ? cacheId(opts.cacheKey, system, prompt, opts.temperature) : null;
  const hit = id ? cache.get(id) : undefined;
  if (hit && Date.now() - hit.at < CACHE_MS) {
    opts.onText?.(hit.text);
    return { text: hit.text, model: hit.model };
  }
  const order = rank(candidates(opts), stats, Date.now());
  if (!order.length || opts.signal?.aborted) return null;

  const out = await new Promise<{ text: string; model: string } | null>((resolve) => {
    const ctrls: (AbortController | undefined)[] = [];
    let next = 0;
    let running = 0;
    let leader = -1;
    let done = false;
    let hedge: ReturnType<typeof setTimeout> | undefined;
    const deadline = setTimeout(() => finish(null), opts.timeoutMs ?? 15_000);
    const gone = () => finish(null);
    opts.signal?.addEventListener("abort", gone);
    function finish(v: { text: string; model: string } | null) {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      clearTimeout(hedge);
      opts.signal?.removeEventListener("abort", gone);
      ctrls.forEach((c) => c?.abort());
      resolve(v);
    }
    function launch() {
      clearTimeout(hedge);
      if (done) return;
      if (next >= order.length) {
        if (running === 0) finish(null);
        return;
      }
      const i = next++;
      const m = order[i];
      const k = keyOf(m);
      const c = new AbortController();
      ctrls[i] = c;
      running++;
      const t0 = Date.now();
      let wrote = false;
      hedge = setTimeout(launch, HEDGE_MS);
      call(m, system, prompt, opts, c.signal, (full) => {
        wrote = true;
        if (leader === -1) {
          // First to write wins the race; the rest stop costing tokens.
          leader = i;
          clearTimeout(hedge);
          ctrls.forEach((x, j) => j !== i && x?.abort());
        }
        if (leader === i) opts.onText?.(full);
      }).then(
        (text) => {
          running--;
          stats.set(k, recordOk(stats.get(k) ?? freshStat(m), Date.now() - t0));
          if (leader === -1 || leader === i) finish({ text, model: m.model });
        },
        (e) => {
          running--;
          const ours = c.signal.aborted;
          // Cancelled because another model wrote first: only a sign of slowness if this one never wrote.
          if (ours && !wrote) stats.set(k, { ...(stats.get(k) ?? freshStat(m)), ewmaMs: (stats.get(k) ?? freshStat(m)).ewmaMs + 500 });
          if (ours || done) return;
          const status = e instanceof CallError ? e.status : 0;
          stats.set(k, recordFail(stats.get(k) ?? freshStat(m), Date.now(), isHardFailure(status, e instanceof CallError ? e.body : "")));
          if (status) console.warn(`[llm] ${k} ${status}`);
          if (leader === i) leader = -1;
          launch();
        },
      );
    }
    launch();
  });
  if (out && id) {
    cache.set(id, { at: Date.now(), ...out });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
  }
  return out;
}
