/**
 * R1238: pure render-state helpers for the Content Intelligence page. Every word the cards show for a missing,
 * thin or impossible number comes from here, so a gap always reads as a gap and never as a 0.
 */
import { MIN_SAMPLE, SIGNAL_MIN_LIFT, confidenceOf } from "@/lib/intelligence/core";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { FORMAT_LABEL, type PostFormat } from "@/lib/formats";
import { METRIC_LABEL, formatMetric, type MetricKey } from "@/lib/insights/post-core";
import { transitions } from "@/lib/intelligence/planner-core";
import type { Outcome } from "@/lib/intelligence/outcome-core";
import type { Confidence, Evidence, FormatGroup, MetricStat, TopicInsight } from "./types";

export const DAY_OPTIONS = [7, 28, 90] as const;
export type DayOption = (typeof DAY_OPTIONS)[number];

export const isPlatformKey = (p: string): p is Platform => Object.prototype.hasOwnProperty.call(PLATFORM_META, p);
export const platformLabel = (p: string) => (isPlatformKey(p) ? PLATFORM_META[p].name : p);
export const formatLabel = (f: string) => (Object.prototype.hasOwnProperty.call(FORMAT_LABEL, f) ? FORMAT_LABEL[f as PostFormat] : f);
export const metricLabel = (m: MetricKey) => METRIC_LABEL[m];

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

export function statusWord(g: Pick<FormatGroup, "status" | "n" | "platform">): string {
  if (g.status === "ok") return "Ranked";
  if (g.status === "unavailable") return `Numbers not provided by ${platformLabel(g.platform)}`;
  return `Not enough posts yet: ${g.n} of the ${MIN_SAMPLE} needed`;
}

export const CONFIDENCE_WORD: Record<Confidence, string> = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };

/** One cell: the median when there is one, otherwise the reason there is none. Never a made-up 0. */
export function metricCell(stat: MetricStat | undefined, platform: string, format: string): string {
  if (!stat) return "Not tracked for this objective";
  if (stat.availability === "unsupported") return `Not possible for a ${formatLabel(format).toLowerCase()} on ${platformLabel(platform)}`;
  if (stat.availability === "unavailable") return `Not provided by ${platformLabel(platform)}`;
  if (stat.median === null) return "No numbers yet";
  return formatMetric(stat.metric, stat.median);
}

export function engagementCell(g: Pick<FormatGroup, "engagementRate" | "status" | "platform">): string {
  if (g.engagementRate !== null) return formatMetric("engagementRate", g.engagementRate);
  return g.status === "unavailable" ? `Not provided by ${platformLabel(g.platform)}` : "No numbers yet";
}

export const viewShareCell = (g: Pick<FormatGroup, "viewShare" | "platform">) => (g.viewShare === null ? `Views not provided by ${platformLabel(g.platform)}` : `${g.viewShare}% of ${platformLabel(g.platform)} views`);

const evidenceValue = (e: Evidence, v: number) => (e.unit === "count" ? formatMetric(e.metric, v) : e.unit === "percent" ? formatMetric("engagementRate", v) : `index ${v}`);

/** "Median 1.2K views vs 800 before, 6 posts, Last 28 days". Topic evidence is an index where 100 is your usual. */
export function evidenceLine(e: Evidence): string {
  const metric = METRIC_LABEL[e.metric].toLowerCase();
  const base = e.unit === "index" ? `vs 100 for your usual posts (${plural(e.baselineN, "post")})` : `vs ${evidenceValue(e, e.baseline)} across the ${plural(e.baselineN, "post")} before`;
  return `Median ${evidenceValue(e, e.value)} ${metric} ${base}, ${plural(e.n, "post")}, ${e.period}`;
}

export const liftWord = (lift: number) => `${lift >= 0 ? "Up" : "Down"} ${Math.round(Math.abs(lift))}%`;

export function confidenceNote(posts: number): { level: Confidence; text: string } {
  const level = confidenceOf(posts);
  return { level, text: `${CONFIDENCE_WORD[level]} overall from ${plural(posts, "post")}. Low under 5 posts, medium under 12, high from 12, and each card shows its own.` };
}

export const hasEnoughPosts = (posts: number) => posts >= MIN_SAMPLE;

/** The honest empty state: what is missing, in numbers. */
export function emptyStateText(posts: number, days: number): string {
  const need = MIN_SAMPLE - Math.max(0, posts);
  return `Outlly needs at least ${MIN_SAMPLE} published posts with numbers in the last ${days} days to compare anything, and you have ${posts}. Publish ${plural(need, "more post")} on Instagram, YouTube or Facebook (the platforms that give Outlly per-post numbers), or pick a longer window.`;
}

export const workingEmptyText = `Nothing is clearly ahead yet. A format counts as working when its median is at least ${SIGNAL_MIN_LIFT}% above the period before, with ${MIN_SAMPLE} or more posts on each side.`;
export const attentionEmptyText = `Nothing is clearly behind. A format needs attention when its median is at least ${SIGNAL_MIN_LIFT}% below the period before, with ${MIN_SAMPLE} or more posts on each side.`;

/** Groups by platform in the engine's order, so the comparison never mixes two platforms' numbers. */
export function byPlatform(formats: FormatGroup[]): { platform: string; groups: FormatGroup[] }[] {
  const out: { platform: string; groups: FormatGroup[] }[] = [];
  for (const g of formats) {
    const last = out.find((x) => x.platform === g.platform);
    if (last) last.groups.push(g);
    else out.push({ platform: g.platform, groups: [g] });
  }
  return out;
}

/** The ranked groups' best posts, each kept with its own group: a carousel is never ranked against a video. */
export function bestGroups(formats: FormatGroup[]): { key: string; platform: string; format: string; metric: MetricKey; top: FormatGroup["top"] }[] {
  return formats
    .filter((g): g is FormatGroup & { primary: MetricKey } => g.status === "ok" && g.primary !== null && g.top.length > 0)
    .map((g) => ({ key: `${g.platform}|${g.format}`, platform: g.platform, format: g.format, metric: g.primary, top: g.top }));
}

export const createHref = (id: string | null | undefined) => (id ? `/create?rec=${encodeURIComponent(id)}` : null);

export function overviewUrl(days: number, objective: string | null, account: string | null, client: string | null = null): string {
  const q = new URLSearchParams({ days: String(days) });
  if (objective) q.set("objective", objective);
  if (account) q.set("account", account);
  // R1243: an agency client's brand profile; "" is the owner's own brand and is the default, so it is never sent.
  if (client) q.set("client", client);
  return `/api/intelligence/overview?${q.toString()}`;
}

/* R1243: agency client views. */

export const CLIENT_KEY_MAX = 100;

export interface ClientProfile {
  scopeKey: string;
  name: string | null;
  objective: string;
  /** R1246: the accounts this client's numbers come from. */
  accountIds?: string[];
}
export interface ClientOption {
  key: string;
  label: string;
}

/**
 * Said under the switcher. R1246: a client with accounts (Settings, Brand) shows only those accounts' numbers; one
 * with none can only change the objective and wording, and the note says so instead of passing the numbers off as its.
 */
export const CLIENT_NOTE =
  "A client with accounts shows only those accounts' numbers. A client with no accounts yet sets the objective and wording only, and the numbers stay this workspace's (or the account you picked).";
export const CLIENT_NO_ACCOUNTS_NOTE = "This client has no accounts yet; add them in Settings, Brand. Until then the numbers are this workspace's.";

/** R1246: the line under the switcher for the choice on screen. Null accounts = your own brand. */
export function clientNote(accounts: number | null): string {
  if (accounts === null) return CLIENT_NOTE;
  if (accounts <= 0) return CLIENT_NO_ACCOUNTS_NOTE;
  return `Numbers from this client's ${plural(accounts, "account")} only.`;
}

/** R1246: how many accounts the selected client has; null for your own brand or a key that is not in the list. */
export function clientAccountCount(profiles: readonly ClientProfile[] | null | undefined, key: string): number | null {
  if (!key || !Array.isArray(profiles)) return null;
  const p = profiles.find((x) => x.scopeKey === key);
  return p ? (Array.isArray(p.accountIds) ? p.accountIds.length : 0) : null;
}

/** The switcher's choices: your own brand first, then each client. Null when there are no clients, so it is not shown. */
export function clientOptions(profiles: readonly ClientProfile[] | null | undefined): ClientOption[] | null {
  const clients = (Array.isArray(profiles) ? profiles : []).filter((p) => typeof p.scopeKey === "string" && p.scopeKey !== "" && p.scopeKey.length <= CLIENT_KEY_MAX);
  if (!clients.length) return null;
  const seen = new Set<string>();
  const out: ClientOption[] = [{ key: "", label: "Your brand" }];
  for (const c of clients) {
    if (seen.has(c.scopeKey)) continue;
    seen.add(c.scopeKey);
    out.push({ key: c.scopeKey, label: c.name?.trim() || c.scopeKey });
  }
  return out;
}

/** A key the switcher may select: one of the options, else your own brand. */
export const pickClient = (options: readonly ClientOption[] | null, key: string | null | undefined): string =>
  options && typeof key === "string" && options.some((o) => o.key === key) ? key : "";

/** Section 9's line: whether the card on screen is exactly what Monday's email will say. */
export function weeklyReportNote(o: { days: number; objective: string; savedObjective: string | null; client: string | null }): string {
  if (o.client) return "Monday's email covers your own brand. This is the same report judged the way this client's profile asks.";
  if (o.days !== 28 || (o.savedObjective !== null && o.objective !== o.savedObjective))
    return "Monday's email reads the last 28 days, judged on your saved objective. Switch back to those to see exactly what it will say.";
  return "This is what Monday's email will say, from the same numbers.";
}

/* R1248: topics, planner actions, outcomes and the posts cap. */

export const POSTS_CAPPED_TEXT = "Only the newest 2000 posts are compared in this period.";

/** The topic row's lead metric: the one the engine judged most of its posts on, else the objective's first. */
export function topicLeadStat(t: Pick<TopicInsight, "metric" | "metrics">): MetricStat | undefined {
  return (t.metric ? t.metrics.find((m) => m.metric === t.metric) : undefined) ?? t.metrics[0];
}

/** "Not enough posts yet: 2 of the 3 needed" until a topic has MIN_SAMPLE posts with a like-for-like score. */
export const topicStatusWord = (t: Pick<TopicInsight, "scored" | "sufficient">) => (t.sufficient ? null : `Not enough posts yet: ${t.scored} of the ${MIN_SAMPLE} needed`);

/**
 * The engine's topic lift is each post against the median of its own platform and format (an index where 100 is
 * your usual), so the words say that, not "the period before". Only shown once a topic has MIN_SAMPLE scored posts.
 */
export function topicLiftText(t: Pick<TopicInsight, "lift" | "sufficient">): string | null {
  if (!t.sufficient || t.lift === null) return null;
  return `${liftWord(t.lift)} vs your usual posts of the same platform and format`;
}

export const hasTopicInsights = (topics: readonly Pick<TopicInsight, "sufficient">[]) => topics.some((t) => t.sufficient);

/** The empty state: no topic has enough posts, and how many the closest one still needs. */
export function topicsEmptyText(topics: readonly Pick<TopicInsight, "topic" | "scored">[]): string {
  const closest = [...topics].sort((a, b) => b.scored - a.scored)[0];
  if (!closest) return `None of the posts in this period has a topic or category yet. A topic needs ${MIN_SAMPLE} posts with numbers before Outlly compares it with your usual posts.`;
  const need = Math.max(1, MIN_SAMPLE - closest.scored);
  return `No topic has ${MIN_SAMPLE} posts with numbers yet. The closest, ${closest.topic}, has ${closest.scored} of the ${MIN_SAMPLE} needed: ${plural(need, "more post")} on it and Outlly can compare it.`;
}

export const REC_STATUS_WORD: Record<string, string> = {
  open: "New",
  saved: "Saved for later",
  accepted: "Accepted",
  edited: "Edited",
  done: "Done",
  rejected: "Not for me",
  expired: "Expired",
};
export const recStatusWord = (status: string) => REC_STATUS_WORD[status] ?? "Unknown";

/** The status the card shows the moment a button is pressed, before the server answers. */
export const REC_STATUS_AFTER = { save: "saved", reject: "rejected", done: "done" } as const;
export type RecMove = keyof typeof REC_STATUS_AFTER;

export type RecControl = "create" | "save" | "reject" | "reject-confirm" | "reject-cancel" | "done" | "feedback";

/**
 * The buttons a card shows: only the legal actions of its status (transitions() in planner-core). Edit is not
 * offered on the dashboard. Rejecting asks first, and feedback is offered once.
 */
export function recControls(status: string, ui: { confirming?: boolean; feedbackGiven?: boolean } = {}): RecControl[] {
  const legal = transitions(status);
  const out: RecControl[] = [];
  if (legal.includes("accept")) out.push("create");
  if (legal.includes("save")) out.push("save");
  if (legal.includes("done")) out.push("done");
  if (legal.includes("reject")) out.push(...(ui.confirming ? (["reject-confirm", "reject-cancel"] as const) : (["reject"] as const)));
  if (legal.includes("feedback") && !ui.feedbackGiven) out.push("feedback");
  return out;
}

/** Statuses whose card carries an outcome line: the post made from it is being measured. */
export const OUTCOME_STATUSES: readonly string[] = ["accepted", "done"];
export const hasOutcomeLine = (status: string) => OUTCOME_STATUSES.includes(status);

export const MEASURING_TEXT = "Measuring: first reading 48 h after publishing";

/**
 * The outcome line: an early signal and its confidence, never a cause. The engine's summary already leads with
 * its verdict, so the verdict becomes the lead word and the rest follows it.
 */
export function outcomeLine(o: Pick<Outcome, "verdict" | "summary" | "confidence"> | null | undefined): { text: string; confidence: Confidence | null } {
  if (!o) return { text: MEASURING_TEXT, confidence: null };
  const rest = o.summary.replace(/^[^:]*:\s*/, "");
  if (o.verdict === "too early") return { text: `Measuring: ${rest}`, confidence: null };
  const lead = o.verdict === "early signal up" ? "up" : o.verdict === "early signal down" ? "down" : "in line";
  return { text: `Early signal, ${lead}: ${rest}`, confidence: o.confidence };
}

/** The list rows with the latest outcome attached to accepted and done rows only; other rows are returned as they are. */
export function withOutcomes<R extends { id: string; status: string }, O>(rows: readonly R[], outcomes: Record<string, O>): (R & { outcome?: O | null })[] {
  return rows.map((r) => (hasOutcomeLine(r.status) ? { ...r, outcome: Object.prototype.hasOwnProperty.call(outcomes, r.id) ? outcomes[r.id] : null } : r));
}
