// Shared domain vocabulary. Safe to import from client and server.

export const PLATFORMS = ["instagram", "youtube", "x", "tiktok", "threads", "facebook", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];
/** Always offered in the studio (they were first). */
export const CORE_PLATFORMS = ["instagram", "youtube", "x"] as const;
/** Real publishers exist; each switches on the moment an admin saves its app keys (Admin > Social platforms). */
export const EXTRA_PLATFORMS = ["tiktok", "threads", "facebook", "linkedin"] as const;
export type AnyPlatform = Platform;
export const isCorePlatform = (p: string) => (CORE_PLATFORMS as readonly string[]).includes(p);

export type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "partial" | "failed";
export type TargetStatus = "pending" | "queued" | "uploading" | "processing" | "published" | "failed";
export type MediaStatus = "uploaded" | "processing" | "ready" | "failed";
export type AccountStatus = "connected" | "needs_reconnect" | "disconnected";

export type ErrorCode =
  | "AUTH_EXPIRED"
  | "RATE_LIMITED"
  | "MEDIA_REJECTED"
  | "NETWORK"
  | "PLATFORM_DOWN"
  | "NOT_CONNECTED"
  | "DUPLICATE"
  | "FORBIDDEN"
  | "NEEDS_APPROVAL"
  | "CANCELED"
  | "UNKNOWN";

export interface PlatformMeta {
  id: Platform;
  name: string;
  format: string; // "Reel", "Short", "Post"
  /** CSS custom property name for the brand accent */
  colorVar: string;
  gradient: string; // tailwind gradient classes
  captionLimit: number;
  titleLimit?: number;
  maxDurationSec: number;
  hashtagStyle: "many" | "few" | "none";
}

export const PLATFORM_META: Record<Platform, PlatformMeta> = {
  instagram: {
    id: "instagram",
    name: "Instagram",
    format: "Reel",
    colorVar: "--instagram",
    gradient: "from-[#f58529] via-[#dd2a7b] to-[#8134af]",
    captionLimit: 2200,
    maxDurationSec: 900,
    hashtagStyle: "many",
  },
  youtube: {
    id: "youtube",
    name: "YouTube",
    format: "Short",
    colorVar: "--youtube",
    gradient: "from-[#ff4d4d] to-[#c4002b]",
    captionLimit: 5000,
    titleLimit: 100,
    maxDurationSec: 180,
    hashtagStyle: "few",
  },
  x: {
    id: "x",
    name: "X",
    format: "Post",
    colorVar: "--x",
    gradient: "from-[#3a3a3a] to-[#0a0a0a]",
    captionLimit: 280,
    maxDurationSec: 140,
    hashtagStyle: "none",
  },
  tiktok: {
    id: "tiktok",
    name: "TikTok",
    format: "Video",
    colorVar: "--tiktok",
    gradient: "from-[#25f4ee] via-[#111111] to-[#fe2c55]",
    captionLimit: 2200,
    maxDurationSec: 600,
    hashtagStyle: "many",
  },
  threads: {
    id: "threads",
    name: "Threads",
    format: "Post",
    colorVar: "--threads",
    gradient: "from-[#2b2b2b] to-[#000000]",
    captionLimit: 500,
    maxDurationSec: 300,
    hashtagStyle: "few",
  },
  facebook: {
    id: "facebook",
    name: "Facebook",
    format: "Reel",
    colorVar: "--facebook",
    gradient: "from-[#4f9cff] to-[#0b5bd3]",
    captionLimit: 5000,
    maxDurationSec: 90,
    hashtagStyle: "few",
  },
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    format: "Video",
    colorVar: "--linkedin",
    gradient: "from-[#2d8fd5] to-[#004182]",
    captionLimit: 3000,
    titleLimit: 200,
    maxDurationSec: 600,
    hashtagStyle: "few",
  },
};

/** Where Outlly can post the creator's first comment (on X it is a reply to the post). Limit = the platform's comment length. */
export const FIRST_COMMENT_LIMIT: Partial<Record<Platform, number>> = { instagram: 2200, youtube: 10000, x: 280 };
export const supportsFirstComment = (p: string): p is Platform => p in FIRST_COMMENT_LIMIT;

/** Human copy for every error code. Technical detail stays behind a disclosure. */
export function humanError(platform: Platform, code: ErrorCode | string | null | undefined) {
  const name = PLATFORM_META[platform].name;
  switch (code) {
    case "AUTH_EXPIRED":
    case "NOT_CONNECTED":
      return { title: `${name} needs you to reconnect.`, action: `Reconnect ${name}`, kind: "reconnect" as const };
    case "RATE_LIMITED":
      return { title: `${name} asked us to slow down for a minute.`, action: "Let's try again", kind: "retry" as const };
    case "MEDIA_REJECTED":
      return { title: `${name} didn't like something about the video.`, action: "Let's try again", kind: "retry" as const };
    case "NETWORK":
    case "PLATFORM_DOWN":
      return { title: `We couldn't reach ${name} just now.`, action: "Let's try again", kind: "retry" as const };
    case "CANCELED":
      return { title: `You stopped this one before it reached ${name}.`, action: "Send it again", kind: "retry" as const };
    default:
      return { title: "Something got in the way.", action: "Let's try again", kind: "retry" as const };
  }
}

export const TARGET_COPY: Record<TargetStatus, string> = {
  pending: "Waiting its turn",
  queued: "Lining up…",
  uploading: "Uploading…",
  processing: "Making it ready…",
  published: "Published",
  failed: "Something got in the way",
};

/**
 * Taking a live post down from inside Outlly, per platform API:
 * delete = the API can delete it; hide = it can also be made private and public again (YouTube only);
 * app = the API refuses (Instagram, TikTok), so the creator removes it in the platform's own app.
 */
export const REMOVAL: Record<Platform, { delete: boolean; hide: boolean }> = {
  instagram: { delete: false, hide: false },
  youtube: { delete: true, hide: true },
  x: { delete: true, hide: false },
  tiktok: { delete: false, hide: false },
  threads: { delete: true, hide: false },
  facebook: { delete: true, hide: false },
  linkedin: { delete: true, hide: false },
};
/** "deleting" = the platform call has started; it only stays if the save after a successful delete failed,
 *  and the next Delete click then finishes the job (still counts as live until then). */
export type RemoveMode = "deleted" | "hidden" | "deleting";

/** Statuses a creator can still stop: nothing has asked the platform to go public yet. */
export const STOPPABLE: readonly TargetStatus[] = ["pending", "queued", "uploading"];

/** Drafts nobody saves for this many days are removed from Outlly (lib/retention/prune.ts); the browser keeps its own copy. */
export const DRAFT_TTL_DAYS = 3;

export function isPlatform(v: unknown): v is Platform {
  return typeof v === "string" && (PLATFORMS as readonly string[]).includes(v);
}

export function derivePostStatus(targets: { platformStatus: string }[], scheduled: boolean): PostStatus {
  if (targets.length === 0) return "draft";
  const s = targets.map((t) => t.platformStatus);
  if (s.every((x) => x === "published")) return "published";
  if (s.some((x) => ["queued", "uploading", "processing"].includes(x))) return "publishing";
  if (s.every((x) => x === "failed")) return "failed";
  if (s.some((x) => x === "failed")) return s.some((x) => x === "published") ? "partial" : "failed";
  if (s.every((x) => x === "pending")) return scheduled ? "scheduled" : "draft";
  return "publishing";
}
