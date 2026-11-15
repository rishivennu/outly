/**
 * P2: what the calendar calls "Requires attention", derived only from fields the post already has (no schema).
 * Client-safe and pure: the calendar recomputes it after every change it makes, so a card never shows a stale
 * label. A failed post stays "Failed"; anything else that will not go out cleanly as it stands needs attention.
 */
import { PLATFORM_META, isPlatform } from "@/lib/domain";

export type AttentionCode =
  | "target_failed"
  | "partly_published"
  | "account_missing"
  | "account_disconnected"
  | "account_reconnect"
  | "account_expired"
  | "approval_pending"
  | "changes_requested"
  | "media_failed"
  | "media_missing"
  | "no_destinations";

export type AttentionReason = { code: AttentionCode; message: string; platform?: string; targetId?: string };

/** A connected account as the calendar may know it: no tokens, only whether it can still post. */
export type AccountState = {
  id: string;
  platform: string;
  status: string;
  /** When its access runs out for good (null: it refreshes itself, or never expires). */
  expiresAt: string | null;
};

export type AttentionTarget = { id: string; platform: string; status: string; errorCode?: string | null };
export type AttentionPost = {
  status: string;
  scheduledAt: string | null;
  requireApproval: boolean;
  approved: boolean;
  review?: { status: string; expired?: boolean } | null;
  format?: string;
  media: { status: string };
  /** Slides on a photo, carousel or story post (undefined: not loaded, so not judged). */
  slideCount?: number;
  targets: AttentionTarget[];
  /** targetId to the account it is pinned to (null or missing: the platform's default account). */
  accountIds?: Record<string, string | null>;
};

export type DisplayStatus = "draft" | "scheduled" | "publishing" | "published" | "failed" | "attention";

export const DISPLAY_LABEL: Record<DisplayStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
  attention: "Requires attention",
};

const name = (p: string) => (isPlatform(p) ? PLATFORM_META[p].name : p);
const WAITING = new Set(["pending", "queued"]);

/** The account a destination goes out on: its pinned one, else the platform's first connected, else the first. */
export function accountFor(t: AttentionTarget, accounts: AccountState[], pinned?: string | null) {
  if (pinned) return accounts.find((a) => a.id === pinned) ?? null;
  const same = accounts.filter((a) => a.platform === t.platform);
  return same.find((a) => a.status === "connected") ?? same[0] ?? null;
}

export function attentionFor(post: AttentionPost, accounts: AccountState[] | null, now = Date.now()): AttentionReason[] {
  if (post.status === "published") return [];
  const out: AttentionReason[] = [];
  for (const t of post.targets) {
    if (t.status !== "failed" || t.errorCode === "CANCELED") continue;
    out.push({ code: "target_failed", platform: t.platform, targetId: t.id, message: `${name(t.platform)} didn't take it.` });
  }
  if (post.status === "partial") out.unshift({ code: "partly_published", message: "Some platforms have it, others don't yet." });
  if (post.status === "publishing" || post.status === "failed" || post.status === "partial") return out;

  // A booked or dated post: will it be able to go out at its time?
  const live = post.targets.filter((t) => WAITING.has(t.status));
  if (!post.targets.length && post.status === "scheduled") out.push({ code: "no_destinations", message: "No platform is picked for it." });
  const when = post.scheduledAt ? Math.max(+new Date(post.scheduledAt), now) : now;
  if (accounts) {
    for (const t of live) {
      const a = accountFor(t, accounts, post.accountIds?.[t.id]);
      const n = name(t.platform);
      if (!a) out.push({ code: "account_missing", platform: t.platform, targetId: t.id, message: `No ${n} account is connected.` });
      else if (a.status === "disconnected") out.push({ code: "account_disconnected", platform: t.platform, targetId: t.id, message: `${n} is disconnected.` });
      else if (a.status === "needs_reconnect") out.push({ code: "account_reconnect", platform: t.platform, targetId: t.id, message: `${n} needs to be reconnected.` });
      else if (a.expiresAt && +new Date(a.expiresAt) <= when) out.push({ code: "account_expired", platform: t.platform, targetId: t.id, message: `${n} access runs out before this goes out.` });
    }
  }
  if (post.status === "scheduled" && post.requireApproval && !post.approved) {
    out.push(post.review?.status === "changes_requested" ? { code: "changes_requested", message: "A reviewer asked for changes." } : { code: "approval_pending", message: "It is held until someone approves it." });
  }
  const slides = post.format && post.format !== "video";
  if (!slides && post.media.status === "failed") out.push({ code: "media_failed", message: "The video didn't finish processing. Upload it again." });
  const n = post.slideCount;
  if (slides && n !== undefined && (n === 0 || (post.format === "carousel" && n < 2)))
    out.push({ code: "media_missing", message: post.format === "carousel" ? "A carousel needs at least 2 slides." : "It has no photo or video yet." });
  return out;
}

/** The one label a card shows. Draft and Scheduled only when nothing needs a hand. */
export function displayStatus(post: Pick<AttentionPost, "status">, reasons: AttentionReason[]): DisplayStatus {
  if (post.status === "published") return "published";
  if (post.status === "publishing") return "publishing";
  if (post.status === "failed") return "failed";
  if (post.status === "partial" || reasons.length) return "attention";
  return post.status === "scheduled" ? "scheduled" : "draft";
}
