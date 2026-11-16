import "server-only";
import { env } from "../env";
import { isOpenRouterKey, kimiRequest, llmText, type LlmOpts } from "../ai/llm";
import { cleanJson } from "../ai/llm-core";

/**
 * R1175: the blog agent's two ways of asking the AI. Gemini never answers here even when it has a key (owner's
 * choice, 11-16). R1177: NVIDIA NIM is the default writer and Kimi the fallback; web research still needs an
 * OpenRouter Kimi key, and without one (or when it fails) research runs on the writer with no web sources.
 * Every stage must fit one serverless call, so the default budget is 50 s.
 */
export class BlogLlmError extends Error {
  constructor(message: string, public retryable = true) {
    super(message);
  }
}

export const blogReady = () => !!env.NVIDIA_API_KEY || !!env.KIMI_API_KEY;
export const blogWebReady = () => isOpenRouterKey(env.KIMI_API_KEY);
const NO_KEY = "No AI key is set for the blog (NVIDIA_API_KEY or KIMI_API_KEY).";

/** The writer's name for the admin pages, read from the model id so a swapped NVIDIA_MODEL shows as itself. */
export function blogModelLabel(): string {
  if (!env.NVIDIA_API_KEY) return "Kimi K2.6";
  const name = env.NVIDIA_MODEL.split("/").pop() ?? env.NVIDIA_MODEL;
  // Drop the trailing size tags (550b, a55b) the NIM ids carry: the owner reads "Nemotron 3 Ultra", not the parameter count.
  const words = name.split("-").filter((w, i) => i === 0 || !/^a?\d+(\.\d+)?b$/i.test(w));
  return `${words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")} (NVIDIA)`;
}

/** One JSON answer. Throws BlogLlmError when nothing answered or the JSON did not parse. */
export async function blogJson<T>(system: string, prompt: string, opts: Pick<LlmOpts, "maxTokens" | "reasoning" | "temperature" | "timeoutMs"> = {}): Promise<{ data: T; model: string }> {
  if (!blogReady()) throw new BlogLlmError(NO_KEY, false);
  const r = await llmText(system, prompt, { providers: ["nvidia", "kimi"], json: true, timeoutMs: opts.timeoutMs ?? 50_000, temperature: opts.temperature ?? 0.6, maxTokens: opts.maxTokens ?? 4096, reasoning: opts.reasoning === true });
  if (!r) throw new BlogLlmError("The AI did not answer in time.");
  return { data: parseJson<T>(r.text), model: r.model };
}

export function parseJson<T>(text: string): T {
  try {
    return JSON.parse(cleanJson(text)) as T;
  } catch {
    throw new BlogLlmError("The AI answer was not valid JSON.");
  }
}

export interface WebCitation {
  url: string;
  title: string;
  content: string;
}

/**
 * JSON answer with live web search (OpenRouter ":online"). The reply's url_citation annotations are the pages the
 * search actually returned, so the research stage can mark those sources verified. Not streamed: annotations only
 * arrive on the whole message. Without an OpenRouter key there is no web plugin, and R1177: any failure of the web
 * call (HTTP error, timeout, bad JSON) falls back to the plain writer too. Either way `citations` is empty and
 * webUsed=false, so the research stage never marks a source verified that no search returned.
 */
export async function blogWebJson<T>(system: string, prompt: string, opts: { maxTokens?: number; timeoutMs?: number } = {}): Promise<{ data: T; citations: WebCitation[]; webUsed: boolean }> {
  if (!blogReady()) throw new BlogLlmError(NO_KEY, false);
  // One budget for both tries: the stage runs inside one serverless call, so the fallback may only use what the
  // web call left (never 50 s + 50 s). The web call gets at most 60% of it; a web call that is still silent at that
  // point would have left too little for the model to write anyway.
  const total = opts.timeoutMs ?? 50_000;
  const started = Date.now();
  const plain = async () => {
    const left = Math.max(8_000, total - (Date.now() - started));
    return { data: (await blogJson<T>(system, prompt, { maxTokens: opts.maxTokens, timeoutMs: left })).data, citations: [] as WebCitation[], webUsed: false };
  };
  if (!blogWebReady()) return plain();
  try {
    return await webJson<T>(system, prompt, { ...opts, timeoutMs: Math.round(total * 0.6) });
  } catch (e) {
    console.warn(`[blog] web research failed, writing without it: ${e instanceof Error ? e.message : e}`);
    return plain();
  }
}

async function webJson<T>(system: string, prompt: string, opts: { maxTokens?: number; timeoutMs?: number }): Promise<{ data: T; citations: WebCitation[]; webUsed: boolean }> {
  const req = kimiRequest(env.KIMI_API_KEY, { model: "kimi-k2.6", stream: false, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }, { maxTokens: opts.maxTokens ?? 4096, reasoning: false, web: true });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 50_000);
  let r: Response;
  try {
    r = await fetch(req.url, { method: "POST", headers: { "content-type": "application/json", ...req.headers }, body: JSON.stringify(req.body), signal: ctrl.signal });
  } catch (e: any) {
    throw new BlogLlmError(e?.name === "AbortError" ? "The research call did not finish in time." : `The research call failed: ${e?.message ?? e}`);
  } finally {
    clearTimeout(t);
  }
  if (!r.ok) {
    const body = (await r.text().catch(() => "")).slice(0, 300);
    throw new BlogLlmError(`The AI returned HTTP ${r.status}: ${body}`, r.status >= 500 || r.status === 429);
  }
  const d: any = await r.json().catch(() => null);
  const msg = d?.choices?.[0]?.message;
  const text: string = typeof msg?.content === "string" ? msg.content : "";
  if (!text.trim()) throw new BlogLlmError("The AI answer was empty.");
  const citations: WebCitation[] = Array.isArray(msg?.annotations)
    ? msg.annotations
        .filter((a: any) => a?.type === "url_citation" && typeof a.url_citation?.url === "string")
        .map((a: any) => ({ url: String(a.url_citation.url), title: String(a.url_citation.title ?? ""), content: String(a.url_citation.content ?? "").slice(0, 600) }))
    : [];
  return { data: parseJson<T>(text), citations, webUsed: true };
}
