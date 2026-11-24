import type { Platform } from "../domain";

/**
 * R1321: a clip's first draft of copy, from its own words only. Deterministic: the title is the first sentence
 * trimmed, the hook its first clause, the caption the first two sentences, the hashtags the clip's own strongest
 * words. AI may reword later through the Create flow; nothing here invents a claim the clip did not make.
 */

export const COPY_MAX = { title: 80, hook: 100, caption: 300, hashtags: 120 } as const;

const STOP = new Set(
  "the a an and or but so if then than that this these those there here is are was were be been being have has had do does did will would can could should may might must of in on at to for from by with about into over after before under again further once because while where when which who whom whose what why how all any both each few more most other some such no nor not only own same too very just also like get got going really thing things want know think make made say said see seen one two three four five lot lots kind sort way ways time times okay right yeah yes well now today people something everything anything nothing".split(/\s+/),
);

export const sentencesOf = (text: string): string[] =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

const cut = (s: string, max: number) => {
  if (s.length <= max) return s;
  const words = s.slice(0, max + 1).split(/\s+/);
  words.pop();
  return words.join(" ").replace(/[,;:\s]+$/, "");
};

export interface ClipCopy {
  title: string;
  hook: string;
  caption: string;
  hashtags: string;
}

/** The most frequent words of 4+ letters that are not stop words, as hashtags; "#shorts" first when YouTube is a target. */
export function hashtagsOf(text: string, platforms: readonly Platform[] = [], max = 5): string {
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9']+/)) {
    const w = raw.replace(/'s$/, "").replace(/'/g, "");
    if (w.length < 4 || STOP.has(w) || /^\d+$/.test(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, max)
    .map(([w]) => `#${w}`);
  const out = platforms.includes("youtube") ? ["#shorts", ...top] : top;
  return out.join(" ").slice(0, COPY_MAX.hashtags);
}

export function draftCopy(text: string, givenTitle: string | null | undefined, platforms: readonly Platform[] = []): ClipCopy {
  const sentences = sentencesOf(text);
  const first = sentences[0] ?? "";
  const title = cut((givenTitle?.trim() || first || "A moment worth watching").replace(/[.]+$/, ""), COPY_MAX.title) || "A moment worth watching";
  const hook = cut(first.split(/[,;:]/)[0] || first || title, COPY_MAX.hook);
  const caption = cut(sentences.slice(0, 2).join(" ") || title, COPY_MAX.caption);
  return { title, hook, caption, hashtags: hashtagsOf(text, platforms) };
}
