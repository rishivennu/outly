import "server-only";
import { PLATFORM_META } from "./domain";
import { generateHooks, generatePlatformCopy, type PlatformCopy } from "./ai/creative";

/**
 * The landing page's "Try it" box (10-28). One line from a visitor in, three real drafts out, written by
 * the same hook + caption engine the studio uses. Public, so it is small on purpose: a short topic, three
 * platforms, a hard time budget, and a cache so the same line never costs a second model call.
 */

export type TryKey = "instagram" | "youtube" | "x";
export type TryDrafts = Record<TryKey, string>;
export type TryResult = { drafts: TryDrafts; source: "gemini" | "studio" };

export const TRY_LIMIT: Record<TryKey, number> = {
  instagram: PLATFORM_META.instagram.captionLimit,
  youtube: PLATFORM_META.youtube.titleLimit ?? 100,
  x: PLATFORM_META.x.captionLimit,
};

export const TRY_BUDGET_MS = 12_000;
// One model and short timeouts, so both calls together end inside the budget (5 + 6 s), and a slow model is
// cut off instead of finishing (and billing) after the visitor already got a 504.
// Two light models: if the first is silent for 2.5 s the second races it (lib/ai/llm.ts), still inside the budget.
const HOOK_CALL = { models: ["gemini-flash-lite-latest", "gemini-3.5-flash-lite"], timeoutMs: 5_000 };
const COPY_CALL = { models: ["gemini-flash-lite-latest", "gemini-3.5-flash-lite"], timeoutMs: 6_000 };

/**
 * Visitor text as one plain line: no control characters, no markup brackets, single spaces. Double quotes become
 * single and backticks go, so a topic can't close the prompt's triple-quote delimiter and write its own instructions.
 */
export function cleanTopic(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/[<>`]/g, "")
    .replace(/["\u201c\u201d]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/** Cut at the last word that fits, never mid-word, never past the limit. */
export function clampTo(s: string, limit: number): string {
  const t = s.trim();
  if (t.length <= limit) return t;
  const cut = t.slice(0, limit - 1);
  const at = cut.search(/\s\S*$/);
  return `${(at > limit * 0.6 ? cut.slice(0, at) : cut).trimEnd()}\u2026`;
}

const firstLine = (s: string) => s.split("\n").map((l) => l.trim()).find(Boolean) ?? "";

/** Engine output to the three cards. Hashtags are added only where the caption has none yet. */
export function toDrafts(copies: PlatformCopy[], topic: string): TryDrafts {
  const by = (p: TryKey) => copies.find((c) => c.platform === p);
  const ig = by("instagram");
  const yt = by("youtube");
  const x = by("x");
  const withTags = (caption: string, tags: string, limit: number) => {
    const c = caption.trim();
    if (!tags || c.includes("#")) return clampTo(c, limit);
    const both = `${c}\n\n${tags.trim()}`;
    return both.length <= limit ? both : clampTo(c, limit);
  };
  return {
    instagram: withTags(ig?.caption || topic, ig?.hashtags ?? "", TRY_LIMIT.instagram),
    youtube: clampTo(firstLine(yt?.title || yt?.caption || topic), TRY_LIMIT.youtube),
    x: clampTo(x?.caption || topic, TRY_LIMIT.x),
  };
}

/** The promise's answer, or null once `ms` passes first. */
export async function withBudget<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((r) => (timer = setTimeout(() => r(null), ms)));
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

const cache = new Map<string, TryResult>();
const CACHE_MAX = 300;

/** Hook first, then captions built on it, all inside TRY_BUDGET_MS. Null when the budget runs out. */
export async function writeTry(topic: string, budgetMs = TRY_BUDGET_MS): Promise<TryResult | null> {
  const key = topic.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const work = (async (): Promise<TryResult> => {
    const hooks = await generateHooks(topic, "default", [], HOOK_CALL);
    const hook = hooks.hooks[0]?.text || topic;
    const copies = await generatePlatformCopy(topic, hook, ["instagram", "youtube", "x"], COPY_CALL);
    // "gemini" only when the model wrote the captions too (the engine sets `why` from the model's answer).
    const source = hooks.source === "gemini" && copies.some((c) => c.why) ? "gemini" : "studio";
    return { drafts: toDrafts(copies, topic), source };
  })();
  const out = await withBudget(work, budgetMs);
  if (out && out.source === "gemini") {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, out);
  }
  return out;
}
