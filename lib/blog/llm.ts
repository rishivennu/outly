import "server-only";
import { env } from "../env";
import { isOpenRouterKey, kimiRequest, llmText, type LlmOpts } from "../ai/llm";
import { cleanJson } from "../ai/llm-core";

/**
 * R1175: the blog agent's two ways of asking Kimi. Kimi only (owner's choice, 11-16): Gemini never answers here
 * even when it has a key. Every stage must fit one serverless call, so the default budget is 50 s.
 */
export class BlogLlmError extends Error {
  constructor(message: string, public retryable = true) {
    super(message);
  }
}

export const blogReady = () => !!env.KIMI_API_KEY;
export const blogWebReady = () => isOpenRouterKey(env.KIMI_API_KEY);

/** One JSON answer. Throws BlogLlmError when nothing answered or the JSON did not parse. */
export async function blogJson<T>(system: string, prompt: string, opts: Pick<LlmOpts, "maxTokens" | "reasoning" | "temperature" | "timeoutMs"> = {}): Promise<{ data: T; model: string }> {
  if (!blogReady()) throw new BlogLlmError("No AI key is set for the blog (KIMI_API_KEY).", false);
  const r = await llmText(system, prompt, { providers: ["kimi"], json: true, timeoutMs: opts.timeoutMs ?? 50_000, temperature: opts.temperature ?? 0.6, maxTokens: opts.maxTokens ?? 4096, reasoning: opts.reasoning === true });
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
 * arrive on the whole message. With a direct Moonshot key there is no web plugin: the call runs without search and
 * `citations` is empty, which the research stage records as webUsed=false.
 */
export async function blogWebJson<T>(system: string, prompt: string, opts: { maxTokens?: number; timeoutMs?: number } = {}): Promise<{ data: T; citations: WebCitation[]; webUsed: boolean }> {
  if (!blogReady()) throw new BlogLlmError("No AI key is set for the blog (KIMI_API_KEY).", false);
  const web = blogWebReady();
  const req = kimiRequest(env.KIMI_API_KEY, { model: "kimi-k2.6", stream: false, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }, { maxTokens: opts.maxTokens ?? 4096, reasoning: false, web });
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
  return { data: parseJson<T>(text), citations, webUsed: web };
}
