import { formatIssues, MAX_SLIDES, takesCaption, type PostFormat, type SlideFacts } from "@/lib/formats";

/**
 * 1131: what stands between a Story, photo or carousel and the Post button. Pure, so the rules are tested
 * apart from the screen. Errors block; warnings are shown and left to the creator.
 */
export interface GateSlide extends SlideFacts {
  status: "working" | "done" | "failed";
}
export const IG_CAPTION_MAX = 2200;
export const IG_HASHTAG_MAX = 30;

export const hashtagCount = (s: string) => (s.match(/(^|\s)#[^\s#]+/g) ?? []).length;

/** The slide count the save route accepts for this format (it refuses anything else). */
export function shapeOk(format: PostFormat, done: number) {
  if (format === "carousel") return done >= 2 && done <= MAX_SLIDES;
  return done === 1;
}

export function formatGate(format: Exclude<PostFormat, "video">, slides: GateSlide[], copy: { caption: string; hashtags: string }, account: { connected: boolean }) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!slides.length) errors.push(format === "photo" ? "Add a photo." : format === "story" ? "Add a photo or video." : "Add at least 2 photos or videos.");
  if (slides.some((s) => s.status === "working")) errors.push("Still uploading. It takes a moment.");
  const failed = slides.filter((s) => s.status === "failed").length;
  if (failed) errors.push(failed === 1 ? "One file didn't upload. Try it again or take it out." : `${failed} files didn't upload. Try them again or take them out.`);
  if (slides.length) {
    for (const i of formatIssues("instagram", format, slides)) (i.level === "error" ? errors : warnings).push(i.message);
  }
  if (takesCaption(format)) {
    const text = [copy.caption.trim(), copy.hashtags.trim()].filter(Boolean).join("\n\n");
    if (text.length > IG_CAPTION_MAX) errors.push(`The caption is ${text.length} characters with its hashtags. Instagram takes up to ${IG_CAPTION_MAX}.`);
    const tags = hashtagCount(`${copy.caption} ${copy.hashtags}`);
    if (tags > IG_HASHTAG_MAX) errors.push(`That's ${tags} hashtags. Instagram takes up to ${IG_HASHTAG_MAX}.`);
  }
  if (!account.connected) errors.push("Connect your Instagram account to post.");
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], ready: errors.length === 0 };
}
