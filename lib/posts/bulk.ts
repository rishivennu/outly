import { PLATFORM_META, type Platform } from "../domain";

/** One video in a batch, as the creator typed it. Client-safe and pure. */
export interface BulkItemCopy {
  title?: string | null;
  caption?: string | null;
  hashtags?: string | null;
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1)).trimEnd()}…`);

/** A title from the file name: "my_trip-day 2.mp4" reads as "My trip day 2". */
export function titleFromFilename(name: string) {
  const base = name.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
  if (!base) return "Untitled";
  return clip(base[0].toUpperCase() + base.slice(1), 100);
}

/**
 * The same copy shaped for each destination: titles where the platform has them, the caption within each
 * platform's limit (X gets its 280 with hashtags folded in only if they fit), YouTube's caption as its description.
 */
export function bulkTargets(item: BulkItemCopy, platforms: Platform[]) {
  const title = item.title?.trim() || null;
  const caption = item.caption?.trim() || "";
  const tags = item.hashtags?.trim() || "";
  return platforms.map((platform) => {
    const meta = PLATFORM_META[platform];
    if (platform === "x") {
      const withTags = tags && caption.length + tags.length + 1 <= meta.captionLimit ? `${caption} ${tags}`.trim() : caption;
      return { platform, title: null, caption: clip(withTags || title || "", meta.captionLimit) || null, description: null, hashtags: null };
    }
    if (platform === "youtube")
      return { platform, title: title ? clip(title, meta.titleLimit ?? 100) : null, caption: null, description: caption ? clip(caption, meta.captionLimit) : null, hashtags: tags || null };
    return {
      platform,
      title: meta.titleLimit && title ? clip(title, meta.titleLimit) : null,
      caption: caption ? clip(caption, meta.captionLimit) : null,
      description: null,
      hashtags: meta.hashtagStyle === "none" ? null : tags || null,
    };
  });
}

/** Platforms this video is too long for, so the planner can say so before anything is booked. */
export function tooLongFor(durationSec: number | null | undefined, platforms: Platform[]) {
  if (!durationSec) return [];
  return platforms.filter((p) => durationSec > PLATFORM_META[p].maxDurationSec + 0.5);
}

export const BULK_MAX = 10;
