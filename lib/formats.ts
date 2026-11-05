import type { Platform } from "./domain";

/**
 * 1131: what a post is made of. "video" is the original single clip (Reels, Shorts, TikTok and the rest);
 * the other three are built from one or more slides (PostMedia rows). Client-safe: the composer and the
 * publish worker read the same rules, so the app never offers what the platform will refuse.
 */
export const POST_FORMATS = ["video", "photo", "carousel", "story"] as const;
export type PostFormat = (typeof POST_FORMATS)[number];
/** The Instagram-only formats with their own composer. Lives here, not in the composer: a server page can't
 *  read values out of a "use client" file (it gets a client reference, and /create crashed on it). */
export type SlideFormat = Exclude<PostFormat, "video">;
export const SLIDE_FORMATS: readonly SlideFormat[] = ["story", "photo", "carousel"];
export const isSlideFormat = (v: unknown): v is SlideFormat => typeof v === "string" && (SLIDE_FORMATS as readonly string[]).includes(v);
export const isPostFormat = (x: unknown): x is PostFormat => typeof x === "string" && (POST_FORMATS as readonly string[]).includes(x);

export const FORMAT_LABEL: Record<PostFormat, string> = { video: "Video", photo: "Photo", carousel: "Carousel", story: "Story" };

/** Instagram takes up to 20 slides in one carousel (images, videos or a mix). */
export const MAX_SLIDES = 20;
/** Instagram's image limit: JPEG, 8 MB. Images are made into JPEGs in the browser before upload. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
/** Feed photos must sit between 4:5 (tall) and 1.91:1 (wide); the browser crops into that range. */
export const FEED_MIN_RATIO = 4 / 5;
export const FEED_MAX_RATIO = 1.91;

export const isImageMime = (m: string | null | undefined) => !!m && m.startsWith("image/");
export const isVideoMime = (m: string | null | undefined) => m === "video/mp4" || m === "video/quicktime";

/**
 * Where each format can go today. Video goes everywhere it always did. Stories, photos and carousels are
 * Instagram for now; the others are switched on here once their publisher speaks the format.
 */
const SUPPORT: Record<Exclude<PostFormat, "video">, readonly Platform[]> = {
  story: ["instagram"],
  photo: ["instagram"],
  carousel: ["instagram"],
};
export function supportsFormat(p: Platform, f: PostFormat) {
  return f === "video" || SUPPORT[f].includes(p);
}
export const platformsFor = (f: PostFormat, all: readonly Platform[]) => all.filter((p) => supportsFormat(p, f));

/** Stories have no caption, no comments and no cover on Instagram. */
export const takesCaption = (f: PostFormat) => f !== "story";
export const takesFirstComment = (f: PostFormat) => f !== "story";

export interface SlideFacts {
  mimeType: string;
  size: number;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
}
export interface FormatIssue {
  level: "error" | "warning";
  message: string;
}

/** The format a set of files makes by default: one video a video, one image a photo, several a carousel. */
export function defaultFormat(items: Pick<SlideFacts, "mimeType">[]): PostFormat {
  if (items.length > 1) return "carousel";
  return items[0] && isImageMime(items[0].mimeType) ? "photo" : "video";
}

/** The formats a set of files can be posted as (the switch in the composer). */
export function formatsFor(items: Pick<SlideFacts, "mimeType">[]): PostFormat[] {
  if (items.length > 1) return ["carousel"];
  if (!items[0]) return [];
  return isImageMime(items[0].mimeType) ? ["photo", "story"] : ["video", "story"];
}

const ratio = (s: SlideFacts) => (s.width && s.height ? s.width / s.height : null);
const secs = (n: number) => `${Math.round(n)}s`;

/**
 * Everything that stops (error) or should give pause (warning) before a non-video post goes to a platform.
 * Video posts keep their per-platform validateMedia checks; this is only for photo, carousel and story.
 */
export function formatIssues(p: Platform, f: PostFormat, items: SlideFacts[]): FormatIssue[] {
  if (f === "video") return [];
  const out: FormatIssue[] = [];
  const name = p === "instagram" ? "Instagram" : p[0].toUpperCase() + p.slice(1);
  if (!supportsFormat(p, f)) return [{ level: "error", message: `${name} can't take a ${FORMAT_LABEL[f].toLowerCase()} from Outlly yet.` }];
  if (!items.length) return [{ level: "error", message: "Add a photo or video first." }];
  const imageCheck = (s: SlideFacts, where: string) => {
    if (s.mimeType !== "image/jpeg") out.push({ level: "error", message: `${where} needs to be a JPEG. Upload it again and Outlly will convert it.` });
    if (s.size > MAX_IMAGE_BYTES) out.push({ level: "error", message: `${where} is over Instagram's 8 MB limit for images.` });
  };
  const videoCheck = (s: SlideFacts, where: string, max: number, maxBytes: number) => {
    if (!isVideoMime(s.mimeType)) out.push({ level: "error", message: `${where} needs to be an MP4 or MOV.` });
    if (s.size > maxBytes) out.push({ level: "error", message: `${where} is over Instagram's ${Math.round(maxBytes / 1e6)} MB limit here.` });
    if (s.duration && s.duration > max) out.push({ level: "error", message: `${where} is ${secs(s.duration)}. Instagram takes up to ${secs(max)} here.` });
    if (s.duration && s.duration < 3) out.push({ level: "error", message: `${where} is under 3 seconds. Instagram needs at least 3.` });
    if (s.duration == null && isVideoMime(s.mimeType)) out.push({ level: "warning", message: `We couldn't read how long ${where.toLowerCase()} is, so Instagram will check its length when it goes up.` });
  };

  if (f === "story") {
    if (items.length > 1) out.push({ level: "error", message: "A Story is one photo or one video. Post the others as a carousel." });
    const s = items[0];
    if (isImageMime(s.mimeType)) imageCheck(s, "The photo");
    else videoCheck(s, "The video", 60, 100e6);
    const r = ratio(s);
    if (r && r > 0.7) out.push({ level: "warning", message: "Stories fill a tall 9:16 screen. This one will show with space around it." });
    return out;
  }
  if (f === "photo") {
    if (items.length > 1) out.push({ level: "error", message: "A photo post is one image. Two or more make a carousel." });
    const s = items[0];
    if (!isImageMime(s.mimeType)) out.push({ level: "error", message: "A photo post needs an image." });
    else imageCheck(s, "The photo");
    const r = ratio(s);
    if (r && (r < FEED_MIN_RATIO - 0.01 || r > FEED_MAX_RATIO + 0.01)) out.push({ level: "error", message: "Instagram feed photos must be between 4:5 tall and 1.91:1 wide. Upload it again and Outlly will crop it to fit." });
    return out;
  }
  // carousel
  if (items.length < 2) out.push({ level: "error", message: "A carousel needs at least 2 slides." });
  if (items.length > MAX_SLIDES) out.push({ level: "error", message: `A carousel takes up to ${MAX_SLIDES} slides. This one has ${items.length}.` });
  items.forEach((s, i) => {
    const where = `Slide ${i + 1}`;
    if (isImageMime(s.mimeType)) {
      imageCheck(s, where);
      const r = ratio(s);
      if (r && (r < FEED_MIN_RATIO - 0.01 || r > FEED_MAX_RATIO + 0.01)) out.push({ level: "error", message: `${where} is outside 4:5 to 1.91:1. Upload it again and Outlly will crop it to fit.` });
    } else videoCheck(s, where, 900, 300e6);
  });
  const first = ratio(items[0]);
  if (first && items.slice(1).some((s) => { const r = ratio(s); return r !== null && Math.abs(r - first) > 0.02; }))
    out.push({ level: "warning", message: "Instagram crops every slide to the shape of the first one. Slides with a different shape lose their edges." });
  return out;
}
