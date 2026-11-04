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
}

export interface Check {
  level: "ok" | "warning" | "error";
  text: string;
}

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
  if (p === "youtube") {
    if (!d.title.trim()) out.push({ level: "error", text: "Add a title. Shorts need one to be found." });
    else if (d.title.length > (meta.titleLimit ?? 100)) out.push({ level: "error", text: `Title is ${d.title.length - 100} characters over.` });
  }
  if (p !== "youtube" && !d.caption.trim()) out.push({ level: "error", text: p === "x" ? "Write something for the post." : "Add a caption." });
  const full = composedCopy(p, d);
  if (full.length > meta.captionLimit) out.push({ level: "error", text: `${full.length - meta.captionLimit} characters over ${meta.name}'s limit.` });
  const fc = (d.firstComment ?? "").trim();
  if (fc && supportsFirstComment(p)) {
    const lim = FIRST_COMMENT_LIMIT[p] ?? Infinity;
    if (fc.length > lim) out.push({ level: "error", text: `First comment is ${fc.length - lim} characters over ${meta.name}'s limit.` });
  }
  if (media?.duration && media.duration > meta.maxDurationSec) out.push({ level: "error", text: `${meta.name} takes up to ${meta.maxDurationSec}s. This video is ${Math.round(media.duration)}s.` });
  if (p !== "x" && media?.width && media?.height && media.width >= media.height) out.push({ level: "warning", text: "Horizontal video. It will show with bars on a vertical screen." });
  if (!out.length) out.push({ level: "ok", text: `${meta.format} looks good` });
  return out;
}

export function blocking(checks: Check[]) {
  return checks.some((c) => c.level === "error");
}
