/**
 * What the comment preview shows (1052). Client-safe: only signed or public URLs, never storage keys or tokens.
 * Pure, so the inbox page, the API and the tests share one definition.
 */
export interface CommentMedia {
  kind: "video" | "image";
  /** Poster for the 9:16 tile and the loading state. */
  thumbnailUrl: string | null;
  /** A file the browser can play itself (our own upload, or Instagram's media_url). */
  videoUrl: string | null;
  /** YouTube's player, without autoplay. Used when there is no file, or the file fails. */
  embedUrl: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
  postedAt: string | null;
  /** "@handle" or the channel name, for the "Posted by" line. */
  account: string | null;
}

/** youtube-nocookie keeps the preview from dropping tracking cookies; no autoplay, ever. */
export function youtubeEmbed(videoId: string) {
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return null;
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&playsinline=1&modestbranding=1`;
}

type IgMedia = { media_type?: string; media_url?: string; thumbnail_url?: string; caption?: string; timestamp?: string };

/** Instagram: a reel's media_url is the video and thumbnail_url its cover; a photo's media_url is the picture. */
export function instagramMedia(m: IgMedia, account: string | null): CommentMedia {
  const video = m.media_type === "VIDEO" || m.media_type === "REELS";
  return {
    kind: video ? "video" : "image",
    thumbnailUrl: (video ? m.thumbnail_url : m.media_url) ?? m.thumbnail_url ?? null,
    videoUrl: video ? m.media_url ?? null : null,
    embedUrl: null,
    caption: m.caption?.trim() || null,
    width: null,
    height: null,
    postedAt: m.timestamp ?? null,
    account,
  };
}

type YtThumbs = Partial<Record<"maxres" | "standard" | "high" | "medium" | "default", { url?: string }>>;

/** The sharpest thumbnail YouTube sent; high/medium are always there for a public video. */
export function youtubeThumb(t: YtThumbs | undefined) {
  if (!t) return null;
  for (const k of ["maxres", "standard", "high", "medium", "default"] as const) if (t[k]?.url) return t[k]!.url!;
  return null;
}

/** Width over height, falling back to the 9:16 a reel or short almost always is. */
export function aspectOf(m: Pick<CommentMedia, "width" | "height"> | null | undefined, fallback = 9 / 16) {
  const w = m?.width ?? 0;
  const h = m?.height ?? 0;
  return w > 0 && h > 0 ? w / h : fallback;
}

/** Every comment on the same post, in thread order (oldest first, like the platform). The caller marks the selected one. */
export function relatedComments<T extends { id: string; targetId: string; createdAt: string }>(all: T[], selected: T) {
  return all.filter((c) => c.targetId === selected.targetId).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}
