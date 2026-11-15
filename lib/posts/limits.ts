import { FIRST_COMMENT_LIMIT, PLATFORM_META, supportsFirstComment, type Platform } from "../domain";
import { composedCopy } from "../client/checks";
import { takesCaption, type PostFormat } from "../formats";

/**
 * Phase 2: hard platform rules checked when a time is set, so a post is refused at booking instead of failing at
 * midnight. Pure. Only caps that already drive the composer or the publishers are used:
 * - text: PLATFORM_META captionLimit / titleLimit and FIRST_COMMENT_LIMIT (lib/domain.ts), counted the way the
 *   publishers send it (composedCopy, lib/client/checks.ts);
 * - media: each publisher's validateMedia / formatIssues (lib/social, lib/formats.ts), the same checks the upload
 *   worker runs (lib/queue/handlers.ts socialUpload);
 * - Instagram's publishing rate limit, below.
 */

/**
 * Meta, Instagram Platform > Content Publishing > Rate limit: "Instagram accounts are limited to 100 API-published
 * posts within a 24-hour moving period. Carousels count as a single post." Meta asks apps that schedule posts to
 * enforce it themselves. https://developers.facebook.com/docs/instagram-platform/content-publishing/
 */
export const PUBLISH_CAPS: Partial<Record<Platform, { max: number; windowMs: number }>> = {
  instagram: { max: 100, windowMs: 24 * 3600_000 },
};

export interface LimitIssue {
  code: "platform_limit";
  platform: Platform;
  message: string;
}

export interface TargetCopy {
  platform: Platform;
  title?: string | null;
  caption?: string | null;
  description?: string | null;
  hashtags?: string | null;
  firstComment?: string | null;
}

const issue = (platform: Platform, message: string): LimitIssue => ({ code: "platform_limit", platform, message });

/** Text over a platform's cap: the platform refuses it, or the publisher has to cut the end off. */
export function copyLimitIssues(t: TargetCopy, format: PostFormat = "video"): LimitIssue[] {
  const meta = PLATFORM_META[t.platform];
  const out: LimitIssue[] = [];
  if (meta.titleLimit && (t.title ?? "").length > meta.titleLimit)
    out.push(issue(t.platform, `The ${meta.name} title is ${(t.title ?? "").length - meta.titleLimit} characters over its ${meta.titleLimit} character limit.`));
  if (takesCaption(format)) {
    const full = composedCopy(t.platform, { caption: t.caption ?? "", description: t.description ?? "", hashtags: t.hashtags ?? "" });
    if (full.length > meta.captionLimit) out.push(issue(t.platform, `The ${meta.name} ${t.platform === "youtube" ? "description" : "caption"} is ${full.length - meta.captionLimit} characters over its ${meta.captionLimit} character limit.`));
  }
  const fc = (t.firstComment ?? "").trim();
  if (fc && supportsFirstComment(t.platform)) {
    const lim = FIRST_COMMENT_LIMIT[t.platform] ?? Infinity;
    if (fc.length > lim) out.push(issue(t.platform, `The first comment on ${meta.name} is ${fc.length - lim} characters over its ${lim} character limit.`));
  }
  return out;
}

/** Errors from the publisher's own media checks become limit issues; warnings never block a booking. */
export function mediaLimitIssues(platform: Platform, checks: { level: "error" | "warning"; message: string }[]): LimitIssue[] {
  return checks.filter((c) => c.level === "error").map((c) => issue(platform, c.message));
}

/**
 * Would one more post at `at` put any moving window of `windowMs` over `max`? `times` are the account's other
 * posts (booked or already out). Every window that contains `at` starts somewhere in [at - windowMs, at].
 */
export function overMovingCap(times: (Date | string | number)[], at: Date | number, max: number, windowMs: number) {
  const t0 = +new Date(at);
  const near = times.map((t) => +new Date(t)).filter((t) => Number.isFinite(t) && Math.abs(t - t0) < windowMs).sort((a, b) => a - b);
  for (const start of [t0 - windowMs + 1, ...near.filter((t) => t <= t0)]) {
    const end = start + windowMs;
    if (start > t0) continue;
    const inside = near.filter((t) => t >= start && t < end).length + 1;
    if (inside > max) return true;
  }
  return false;
}

export function capIssue(platform: Platform): LimitIssue | null {
  const cap = PUBLISH_CAPS[platform];
  if (!cap) return null;
  return issue(platform, `${PLATFORM_META[platform].name} allows ${cap.max} posts from apps in any ${Math.round(cap.windowMs / 3600_000)} hours, and this account would go over. Pick a later time.`);
}
