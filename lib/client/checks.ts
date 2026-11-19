import { FIRST_COMMENT_LIMIT, PLATFORM_META, supportsFirstComment, type Platform } from "@/lib/domain";

export interface Draft {
  enabled: boolean;
  title: string;
  caption: string;
  description: string;
  hashtags: string;
  /** Posted as the first comment (a reply on X) a few seconds after the post goes live. */
  firstComment: string;
  note: string;
  /** Caption engine line for the card, e.g. "Myth Buster · Curiosity hook · optimised for saves". */
  why?: string;
  reviewed: boolean;
  /** Client only, never saved: this platform has its own caption instead of following the main caption. */
  custom?: boolean;
  /** R1209, client only: typed in since Pip wrote it and not approved yet (the Edited state). */
  edited?: boolean;
  /** R1209, client only: typed in after it was approved, so it needs review again. */
  reopened?: boolean;
  /** 1162: the account this place goes to when the creator has more than one there. Unset = the pinned or default one. */
  accountId?: string | null;
}

/** Which field a check is about, so the deck can show it right under that field. */
export type CheckField = "title" | "body" | "hashtags" | "firstComment" | "media" | "account";

export interface Check {
  level: "ok" | "warning" | "error";
  text: string;
  field?: CheckField;
}

/** Real platform rules on hashtags: Instagram refuses more than 30; YouTube ignores all of them past 15. */
export const HASHTAG_CAP: Partial<Record<Platform, { max: number; level: Check["level"]; text: string }>> = {
  instagram: { max: 30, level: "error", text: "Instagram takes up to 30 hashtags." },
  youtube: { max: 15, level: "warning", text: "YouTube ignores every hashtag when there are more than 15." },
};

export const countHashtags = (s: string) => (s.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;

/**
 * The text the platform will actually receive: every publisher except X appends the hashtags field to the
 * body (YouTube to the description), so the limit has to count both. Counting the caption alone let a
 * creator past the gate and the publisher then clipped the end of their caption, or the platform refused it.
 */
export function composedCopy(p: Platform, d: Pick<Draft, "caption" | "description" | "hashtags">) {
  if (p === "x") return d.caption; // no hashtags field on X
  const body = p === "youtube" ? d.description : d.caption || d.description;
  return [body, d.hashtags].filter(Boolean).join("\n\n");
}

export function checksFor(p: Platform, d: Draft, media: { duration?: number | null; width?: number | null; height?: number | null } | null): Check[] {
  const meta = PLATFORM_META[p];
  const out: Check[] = [];
  if (p === "youtube" && !d.title.trim()) out.push({ level: "error", text: "Add a title. Shorts need one to be found.", field: "title" });
  // LinkedIn also sends the title (up to 200), so its limit is checked the same way.
  if (meta.titleLimit && d.title.length > meta.titleLimit) out.push({ level: "error", text: `Title is ${d.title.length - meta.titleLimit} characters over.`, field: "title" });
  if (p !== "youtube" && !d.caption.trim()) out.push({ level: "error", text: p === "x" ? "Write something for the post." : "Add a caption.", field: "body" });
  const full = composedCopy(p, d);
  if (full.length > meta.captionLimit) out.push({ level: "error", text: `${full.length - meta.captionLimit} characters over ${meta.name}'s limit.`, field: "body" });
  const cap = HASHTAG_CAP[p];
  const tags = cap && meta.hashtagStyle !== "none" ? countHashtags(d.hashtags) + countHashtags(p === "youtube" ? d.description : d.caption) : 0;
  if (cap && tags > cap.max) out.push({ level: cap.level, text: `${cap.text} This has ${tags}.`, field: "hashtags" });
  const fc = (d.firstComment ?? "").trim();
  if (fc && supportsFirstComment(p)) {
    const lim = FIRST_COMMENT_LIMIT[p] ?? Infinity;
    if (fc.length > lim) out.push({ level: "error", text: `First comment is ${fc.length - lim} characters over ${meta.name}'s limit.`, field: "firstComment" });
  }
  if (media?.duration && media.duration > meta.maxDurationSec) out.push({ level: "error", text: `${meta.name} takes up to ${meta.maxDurationSec}s. This video is ${Math.round(media.duration)}s.`, field: "media" });
  if (p !== "x" && media?.width && media?.height && media.width >= media.height) out.push({ level: "warning", text: "Horizontal video. It will show with bars on a vertical screen.", field: "media" });
  if (!out.length) out.push({ level: "ok", text: `${meta.format} looks good` });
  return out;
}

export function blocking(checks: Check[]) {
  return checks.some((c) => c.level === "error");
}
