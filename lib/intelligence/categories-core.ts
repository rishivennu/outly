/**
 * R1237: pure rules for content categories and topics (no I/O), shared by the server module and its tests.
 */

export const NAME_MAX = 40;
export const KEYWORD_MAX = 30;
export const KEYWORDS_MAX = 20;
export const TOPIC_MAX = 60;
export const TAGS_PER_ITEM = 5;
export const CATEGORIES_PER_OWNER = 50;

const tidy = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** Trimmed, inner spaces collapsed, at most 40 characters. "" when nothing is left. */
export const normaliseName = (v: unknown): string => tidy(v).slice(0, NAME_MAX).trim();

/** The key two names are compared on: "Recipes" and " recipes " are the same category. */
export const nameKey = (v: unknown): string => normaliseName(v).toLowerCase();

/** Up to 20 keywords of up to 30 characters, blanks dropped, duplicates (ignoring case) dropped, first kept. */
export function normaliseKeywords(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of v) {
    const w = tidy(k).slice(0, KEYWORD_MAX).trim();
    if (!w || seen.has(w.toLowerCase())) continue;
    seen.add(w.toLowerCase());
    out.push(w);
    if (out.length === KEYWORDS_MAX) break;
  }
  return out;
}

/** The stored JSON keyword list, read defensively: anything that is not a string array reads as no keywords. */
export function parseKeywords(s: string | null | undefined): string[] {
  if (typeof s !== "string" || !s.trim()) return [];
  try {
    return normaliseKeywords(JSON.parse(s));
  } catch {
    return [];
  }
}

/** A topic of up to 60 characters, or null to clear it. */
export const normaliseTopic = (v: unknown): string | null => tidy(v).slice(0, TOPIC_MAX).trim() || null;

/** The same ids once each, in the order given. */
export const uniqueIds = (ids: readonly string[]): string[] => [...new Set(ids.filter((x) => typeof x === "string" && x))];

/** The text a post is classified on: its title, words and hook. */
export const postText = (p: { title?: string | null; story?: string | null; hook?: string | null }): string =>
  [p.title, p.story, p.hook].filter((x): x is string => typeof x === "string" && !!x.trim()).join("\n");
