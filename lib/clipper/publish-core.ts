import type { Platform } from "../domain";
import type { MetricKey } from "../insights/post-core";
import { availabilityOf, type Availability } from "../intelligence/core";

/**
 * R1323: the pure side of posting a clip and reading how it did. What the composer is handed, what the clip screen
 * says about its post, and the numbers rule: a metric a platform never reports is "unavailable", never 0.
 */

export interface ClipPrefill {
  /** The main caption box: the clip's caption, then its hashtags on their own line. */
  story: string;
  hook: string | null;
  title: string;
  /** Platforms the job was set up for; empty keeps the composer's defaults. */
  platforms: Platform[];
  clipId: string;
}

export function clipPrefill(clip: { id: string; title: string; hook: string | null; caption: string | null; hashtags: string | null }, platforms: readonly Platform[]): ClipPrefill {
  const caption = (clip.caption ?? "").trim();
  const tags = (clip.hashtags ?? "").trim();
  const story = [caption, tags].filter(Boolean).join("\n\n") || clip.title;
  return { story: story.slice(0, 4000), hook: clip.hook?.trim() || null, title: clip.title.slice(0, 200), platforms: [...platforms], clipId: clip.id };
}

/** The metrics the clip screen reads for one destination. */
export const CLIP_METRICS: readonly MetricKey[] = ["views", "likes", "comments", "shares", "saves"];

export interface ClipMetric {
  key: MetricKey;
  /** The number when the platform reported one (a real zero is 0); null otherwise. */
  value: number | null;
  availability: Availability;
}

export interface ClipPlatformPerformance {
  platform: string;
  /** The destination's own state: pending | queued | uploading | processing | published | failed. */
  status: string;
  publishedAt: string | null;
  /** When the numbers were last read from the platform; null = never. */
  checkedAt: string | null;
  metrics: ClipMetric[];
}

/** One destination's numbers. `raw` is the latest TargetMetric row, or null when none was ever read. */
export function platformPerformance(t: { platform: string; platformStatus: string; publishedAt: Date | string | null; metricsCheckedAt: Date | string | null }, format: string, raw: Partial<Record<MetricKey, number | null>> | null): ClipPlatformPerformance {
  const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
  const metrics = CLIP_METRICS.map((key) => {
    const v = raw ? raw[key] : null;
    const availability = availabilityOf(t.platform, format, key, raw ? v : null);
    return { key, value: availability === "available" || availability === "zero" ? (v as number) : null, availability };
  });
  return { platform: t.platform, status: t.platformStatus, publishedAt: iso(t.publishedAt), checkedAt: iso(t.metricsCheckedAt), metrics };
}

/** The one line a clip row shows about its post. Never a number the platform did not give. */
export function performanceLine(post: { status: string; scheduledAt: string | null; publishedAt: string | null } | null, platforms: ClipPlatformPerformance[]): string {
  if (!post) return "Not posted yet";
  if (post.status === "scheduled") return post.scheduledAt ? `Scheduled for ${new Date(post.scheduledAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : "Scheduled";
  if (post.status === "publishing") return "Going out now";
  if (post.status === "failed") return "The post failed. Open it in Create to see why.";
  if (post.status !== "published" && post.status !== "partial") return "Draft in Create";
  const live = platforms.filter((p) => p.status === "published");
  if (!live.length) return "Published";
  const views = live.map((p) => p.metrics.find((m) => m.key === "views")).filter((m): m is ClipMetric => !!m && m.value !== null);
  if (!views.length) return live.some((p) => p.checkedAt) ? "Published. Views are not reported for this destination yet." : "Published. Numbers arrive after the first sync.";
  const total = views.reduce((s, m) => s + (m.value ?? 0), 0);
  const where = views.length < live.length ? ` on ${views.length} of ${live.length} destinations` : "";
  return `Published. ${total.toLocaleString()} view${total === 1 ? "" : "s"}${where}.`;
}
