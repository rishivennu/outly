import "server-only";
import { gemini, type GeminiOpts } from "./creative";

/**
 * 1133: the assistant looks at the photos of a photo post or carousel (and reads any words in them: signs,
 * menus, slides, labels, screenshots) and writes the Instagram caption, hashtags and one description per photo.
 * Instagram gives a carousel one caption, so each photo gets its own description (alt text) instead.
 */
export type PhotoCopy = { caption: string; hashtags: string; alts: string[] };

const asText = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const SYSTEM = `You write Instagram captions for a creator, from their photos. Look closely at every photo and read any text in it (signs, menus, posters, slides, product labels, screenshots, price tags) and use those facts. Be specific to what is really there. Never invent names, places, prices, dates or claims you can't see. Sound like a friendly person, not a brand: short lines, plain words, at most one emoji per line, no hashtags inside the caption.`;

/** Hashtags as "#a #b", at most `max`, each one word. */
export function tidyTags(raw: string, max = 10) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of raw.split(/[\s,]+/)) {
    const t = w.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(`#${t}`);
    if (out.length >= max) break;
  }
  return out.join(" ");
}

export function photoPrompt(count: number, format: "photo" | "carousel") {
  const what = format === "carousel" ? `an Instagram carousel of ${count} photos, in swipe order (photo 1 is the cover)` : "one Instagram photo post";
  return `This is ${what}.
Answer in JSON only:
{"caption": string, "hashtags": string, "alts": [string, ...]}
- caption: the first line is a hook under 120 characters that makes people stop; then 1 to 4 short lines about what the photos show${format === "carousel" ? " (it can nudge people to swipe)" : ""}; under 900 characters in all; no hashtags.
- hashtags: 5 to 10 relevant hashtags separated by spaces.
- alts: exactly ${count} item${count === 1 ? "" : "s"}, one per photo in order: one plain sentence under 180 characters saying what is in that photo for someone who can't see it, including any important words written in it.`;
}

/** Null when no model could look at the photos in time. */
export async function generatePhotoCopy(images: { mime: string; data: string }[], format: "photo" | "carousel", opts: GeminiOpts & { voice?: string } = {}): Promise<PhotoCopy | null> {
  const { voice, ...rest } = opts;
  const g = await gemini<{ caption?: unknown; hashtags?: unknown; alts?: unknown }>(SYSTEM + (voice ?? ""), photoPrompt(images.length, format), {
    temperature: 0.8,
    timeoutMs: 30_000,
    ...rest,
    images,
  });
  const caption = asText(g?.caption).replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "").trim().slice(0, 1800);
  if (!g || !caption) return null;
  const alts = Array.isArray(g.alts) ? g.alts.map((a) => asText(a).slice(0, 1000)) : [];
  return { caption, hashtags: tidyTags(asText(g.hashtags)), alts: images.map((_, i) => alts[i] ?? "") };
}
