import "server-only";
import { createHash } from "node:crypto";
import { env } from "../env";
import { HEDGE_MS, deltaText, wholeText, freshStat, isHardFailure, keyOf, rank, recordFail, recordOk, sseEvents, usageOf, type ModelId, type ModelStat, type Provider, type TokenUsage } from "./llm-core";

/**
 * Every text model call goes through here (1053). Before, one fixed order was tried one after another, and
 * the fallback (gemini-flash-latest) hung until its 15 s timeout, so any blip on the first model cost 15 s+.
 * Now: the fastest working model goes first (measured, per instance); if it shows no text within HEDGE_MS the
 * next starts alongside it and whichever writes first wins, the other is cancelled. Kimi (Moonshot) joins
 * when KIMI_API_KEY is set. A model out of credit, unauthorised or gone sits out for a while.
 *
 * R1177: NVIDIA NIM is the default (owner's choice, 11-16) and is tried first whenever NVIDIA_API_KEY is set,
 * even when a Gemini model has measured faster: Gemini is on the throttled free tier and Kimi needs OpenRouter
 * credit, so both now stand behind it. Measured 11-16 with thinking off: Nemotron 3 Ultra 1.9 s on a short JSON
 * answer, Nemotron 3.5 Lightning 0.5 s, Nemotron 3.5 Super VL 0.5 s (vision). DeepSeek V4.1 Flash timed out at
 * 90 s three times. The hedge and bench rules below still cover a slow or down NIM. Model ids come from env
 * (NVIDIA_MODEL, NVIDIA_FAST_MODEL, NVIDIA_VISION_MODEL) so a swap needs no code change.
 */

const GEMINI_DEFAULT = ["gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-3.6-flash"];
// gemini-flash-latest stopped answering (30 s timeouts, 10-30 benchmark); callers that ask for it get 3.6 Flash.
const ALIAS: Record<string, string> = { "gemini-flash-latest": "gemini-3.6-flash" };
const KIMI_MODEL = "kimi-k2.6";
const KIMI_URL = "https://api.moonshot.ai/v1/chat/completions";
/**
 * 1174: KIMI_API_KEY may be an OpenRouter key (sk-or-...), which reaches the same Kimi K2.6 through
 * openrouter.ai with the same OpenAI-shaped request and stream. Measured 11-16: with reasoning left on, K2.6
 * there spent ~600 thinking tokens and 8 s on a one-line caption; off, 61 tokens and 2 s. So reasoning is off
 * unless a caller asks for it, and max_tokens is always sent (OpenRouter refuses an unbounded request when the
 * balance is low).
 */
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "moonshotai/kimi-k2.6";
export const isOpenRouterKey = (key: string) => key.startsWith("sk-or-");
export function kimiRequest(key: string, body: Record<string, unknown>, opts: Pick<LlmOpts, "maxTokens" | "reasoning" | "web">): { url: string; headers: Record<string, string>; body: unknown } {
  if (!isOpenRouterKey(key)) return { url: KIMI_URL, headers: { authorization: `Bearer ${key}` }, body };
  return {
    url: OPENROUTER_URL,
    headers: { authorization: `Bearer ${key}`, "HTTP-Referer": "https://outlly.com", "X-Title": "Outlly" },
    // ":online" is OpenRouter's web plugin (R1175 blog research): the model sees live search results and the
    // reply carries url_citation annotations, so recorded sources are pages that were actually found.
    body: { ...body, model: opts.web ? `${OPENROUTER_MODEL}:online` : OPENROUTER_MODEL, max_tokens: opts.maxTokens ?? 4096, reasoning: { enabled: opts.reasoning === true } },
  };
}

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
/**
 * R1177: NIM takes the OpenAI shape. Thinking is switched per model family through chat_template_kwargs (the
 * `reasoning` field is OpenRouter's and NIM does not read it); off by default, since a thinking Nemotron spends
 * its whole token budget before the first word of a caption.
 */
export function nvidiaRequest(key: string, body: Record<string, unknown>, opts: Pick<LlmOpts, "maxTokens" | "reasoning" | "temperature" | "json">): { url: string; headers: Record<string, string>; body: unknown } {
  const model = String(body.model ?? "");
  const think = opts.reasoning === true;
  const kwargs = model.startsWith("nvidia/") ? { chat_template_kwargs: { enable_thinking: think } } : model.startsWith("deepseek-ai/") ? { chat_template_kwargs: { thinking: think } } : {};
  return {
    url: NVIDIA_URL,
    headers: { authorization: `Bearer ${key}` },
    body: { ...body, ...(opts.json !== false ? { response_format: { type: "json_object" } } : {}), max_tokens: opts.maxTokens ?? 4096, temperature: opts.temperature ?? 0.6, ...kwargs },
  };
}

const stats = new Map<string, ModelStat>();
export const modelStats = () => Object.fromEntries(stats);
/** Tests only: forget every model's speed and bench, so one test file's mocked failures never reorder the next. */
export const resetModelStats = () => stats.clear();

export type LlmOpts = {
  temperature?: number;
  timeoutMs?: number;
  /** Gemini models to use, best first. NVIDIA goes ahead of them and Kimi last, each when it has a key. */
  models?: string[];
  json?: boolean;
  /** The whole text so far from the model currently writing (it can restart shorter if that model fails). */
  onText?: (text: string) => void;
  /** Reuse an identical answer for a few minutes (pass something unique to the caller, e.g. the user id). */
  cacheKey?: string;
  /** The caller went away (closed the tab, asked again): stop every model at once. */
  signal?: AbortSignal;
  /** 1133: pictures the model looks at before the prompt (base64, JPEG). Gemini takes them inline; Kimi (K2.6 reads
   * images) as OpenAI content parts, so a throttled Gemini no longer leaves a video unwatched (1174). */
  images?: { mime: string; data: string }[];
  /** Longest answer wanted, in tokens (sent to OpenRouter; default 4096, enough for a 2,500-word article). */
  maxTokens?: number;
  /** Let a thinking model think (slower, dearer): only for long-form work such as the blog writer. */
  reasoning?: boolean;
  /** Web search alongside the prompt (OpenRouter keys only; ignored elsewhere). */
  web?: boolean;
  /** Only these providers may answer (R1175 blog: Kimi only; R1177: NVIDIA then Kimi, never Gemini). Default: all with a key. */
  providers?: Provider[];
  /** R1315: who and what this call is for, so its tokens land in the cost ledger under that feature and person. Omitted = feature "ai". */
  meter?: { feature: string; userId?: string | null };
};

function candidates(opts: LlmOpts): ModelId[] {
  const g = (opts.models?.length ? opts.models : GEMINI_DEFAULT).map((m) => ALIAS[m] ?? m);
  const nv = opts.images?.length ? [env.NVIDIA_VISION_MODEL] : [env.NVIDIA_MODEL, env.NVIDIA_FAST_MODEL];
  const list: ModelId[] = env.NVIDIA_API_KEY ? [...new Set(nv.filter(Boolean))].map((model) => ({ provider: "nvidia" as const, model })) : [];
  if (env.GEMINI_API_KEY) list.push(...[...new Set(g)].map((model) => ({ provider: "gemini" as const, model })));
  if (env.KIMI_API_KEY) list.push({ provider: "kimi", model: KIMI_MODEL });
  return opts.providers ? list.filter((m) => opts.providers!.includes(m.provider)) : list;
}

/** Kimi's user turn: plain text, or the pictures first (as data URLs) and the prompt last, like Gemini's parts. */
export function kimiUser(prompt: string, images: LlmOpts["images"] = []) {
  if (!images.length) return prompt;
  return [...images.map((i) => ({ type: "image_url" as const, image_url: { url: `data:${i.mime};base64,${i.data}` } })), { type: "text" as const, text: prompt }];
}

class CallError extends Error {
  constructor(public status: number, public body: string) {
    super(`HTTP ${status}`);
  }
}

async function call(m: ModelId, system: string, prompt: string, opts: LlmOpts, signal: AbortSignal, onDelta: (full: string) => void, onUsage: (u: TokenUsage) => void = () => {}): Promise<string> {
  const req: { url: string; headers: Record<string, string>; body: unknown } =
    m.provider === "gemini"
      ? {
          url: `https://generativelanguage.googleapis.com/v1beta/models/${m.model}:streamGenerateContent?alt=sse`,
          headers: { "x-goog-api-key": env.GEMINI_API_KEY },
          body: {
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [...(opts.images ?? []).map((i) => ({ inline_data: { mime_type: i.mime, data: i.data } })), { text: prompt }] }],
            generationConfig: { ...(opts.json !== false ? { responseMimeType: "application/json" } : {}), temperature: opts.temperature ?? 0.9 },
          },
        }
      : m.provider === "nvidia"
      ? nvidiaRequest(
          env.NVIDIA_API_KEY,
          { model: m.model, stream: true, stream_options: { include_usage: true }, messages: [{ role: "system", content: system }, { role: "user", content: kimiUser(prompt, opts.images) }] },
          opts,
        )
      : kimiRequest(
          env.KIMI_API_KEY,
          {
            model: m.model,
            stream: true,
            stream_options: { include_usage: true }, // R1315: the last chunk carries token usage for the cost ledger
            ...(opts.json !== false ? { response_format: { type: "json_object" } } : {}),
            messages: [{ role: "system", content: system }, { role: "user", content: kimiUser(prompt, opts.images) }],
          },
          opts,
        );
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
      const u = usageOf(m.provider, e);
      if (u) onUsage(u);
    }
    if (grew) onDelta(text);
  }
  for (const e of sseEvents(buf + "\n\n").events) {
    text += deltaText(m.provider, e);
    const u = usageOf(m.provider, e);
    if (u) onUsage(u);
  }
  if (!text.trim() && raw.trimStart().match(/^[[{]/)) {
    text = wholeText(m.provider, raw);
    if (text.trim()) onDelta(text); // so the race sees this model wrote, like a streamed answer
  }
  if (!text.trim()) throw new CallError(204, "empty");
  return text;
}

/** Gemini reports thinking tokens beside the answer's and bills both at the output rate; OpenAI-shaped APIs already count reasoning inside completion_tokens. */
export const billableOutput = (provider: ModelId["provider"], u: TokenUsage) => (provider === "gemini" ? u.output + u.thoughts : u.output);

/** R1315: tokens into the cost ledger (lib/costs). Fire-and-forget by design here: the ledger never slows or breaks an answer. */
function meterTokens(m: ModelId, u: TokenUsage, meter: LlmOpts["meter"]) {
  import("../costs/tokens").then((t) => t.recordTokens({ provider: m.provider, model: m.model, input: u.input, output: billableOutput(m.provider, u), feature: meter?.feature ?? "ai", userId: meter?.userId ?? null })).catch(() => {});
}

const cache = new Map<string, { at: number; text: string; model: string }>();
const CACHE_MS = 10 * 60_000;
const cacheId = (k: string, system: string, prompt: string, t: number | undefined, images: LlmOpts["images"] = []) => {
  const h = createHash("sha256").update(`${k}\u0000${t}\u0000${system}\u0000${prompt}`);
  for (const i of images) h.update(`\u0000${i.mime}\u0000`).update(i.data);
  return h.digest("base64url");
};

/** The raw text of the fastest good answer, or null when nothing answered in time. */
export async function llmText(system: string, prompt: string, opts: LlmOpts = {}): Promise<{ text: string; model: string } | null> {
  const id = opts.cacheKey ? cacheId(opts.cacheKey, system, prompt, opts.temperature, opts.images) : null;
  const hit = id ? cache.get(id) : undefined;
  if (hit && Date.now() - hit.at < CACHE_MS) {
    opts.onText?.(hit.text);
    return { text: hit.text, model: hit.model };
  }
  const order = rank(candidates(opts), stats, Date.now(), env.NVIDIA_API_KEY ? "nvidia" : undefined);
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
      let usage: TokenUsage | null = null;
      // R1315: whatever the provider reported is booked, won or cancelled: a cancelled model still billed the prompt it read.
      const book = () => usage && meterTokens(m, usage, opts.meter);
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
      }, (u) => (usage = u)).then(
        (text) => {
          running--;
          book();
          stats.set(k, recordOk(stats.get(k) ?? freshStat(m), Date.now() - t0));
          if (leader === -1 || leader === i) finish({ text, model: m.model });
        },
        (e) => {
          running--;
          book();
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
