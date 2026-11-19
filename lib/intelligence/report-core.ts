/**
 * R1243: the Weekly Intelligence Report, pure. It only reorders and words what the engine already measured in an
 * Overview (lib/intelligence/service.ts): no new sums, never a total across platforms, and every gap keeps the
 * dashboard's wording (components/intelligence/view-core.ts), so the email, the dashboard card and the page agree.
 */
import { MIN_SAMPLE, OBJECTIVE_METRICS, confidenceOf, isObjective, type Confidence, type Objective, type Signal } from "./core";
import { objectiveOptions } from "./brand-core";
import { CONFIDENCE_WORD, confidenceNote, createHref, emptyStateText, evidenceLine, hasEnoughPosts, platformLabel } from "../../components/intelligence/view-core";
import type { Overview } from "./service";

export const REPORT_MAX_ITEMS = 3;
const TITLE_MAX = 140;
const LINE_MAX = 240;

export type ReportOverview = Pick<Overview, "period" | "objective" | "posts" | "postsAnalyzed" | "formats" | "working" | "attention" | "recommendations" | "recommendationsReason">;

export interface ReportLine {
  title: string;
  evidence: string;
  confidence: Confidence;
  confidenceText: string;
}
export interface ReportRecommendation {
  title: string;
  concept: string;
  why: string;
  confidenceText: string;
  href: string | null;
}
export interface WeeklyIntelligence {
  enough: boolean;
  headline: string;
  /** Compared with the previous report's numbers, when one was given. */
  versus: string | null;
  movers: ReportLine[];
  attention: ReportLine[];
  topRecommendation: ReportRecommendation | null;
  /** Why there is no recommendation, when there is none and there were enough posts to look. */
  recommendationNote: string | null;
  posts: number;
  postsAnalyzed: number;
  period: string;
  objective: Objective;
  objectiveLabel: string;
  caveats: string[];
  /** The honest empty state: how many more posts are needed. Null once there are enough. */
  emptyText: string | null;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

function line(s: Signal): ReportLine {
  return {
    title: clip(s.title, TITLE_MAX),
    evidence: clip(evidenceLine(s.evidence), LINE_MAX),
    confidence: s.confidence,
    confidenceText: `${CONFIDENCE_WORD[s.confidence]} from ${plural(s.postsAnalyzed, "post")}`,
  };
}

/** Strongest first, then by id, so the same overview always gives the same report. */
const strongest = (xs: readonly Signal[]) => [...(Array.isArray(xs) ? xs : [])].sort((a, b) => Math.abs(b.evidence.lift) - Math.abs(a.evidence.lift) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

function caveatsOf(o: ReportOverview, objective: Objective, enough: boolean): string[] {
  const out: string[] = [];
  const meta = OBJECTIVE_METRICS[objective];
  if (meta.proxy) out.push(`Measured by a proxy: ${meta.reason}`);
  const formats = Array.isArray(o.formats) ? o.formats : [];
  const silent = [...new Set(formats.filter((g) => g.status === "unavailable").map((g) => g.platform))];
  if (silent.length) out.push(`${silent.map(platformLabel).join(", ")} ${silent.length === 1 ? "does" : "do"} not give Outlly per-post numbers, so those posts are counted but not compared.`);
  const thin = formats.filter((g) => g.status === "insufficient").length;
  if (thin) out.push(`${plural(thin, "platform and format group")} ${thin === 1 ? "has" : "have"} fewer than ${MIN_SAMPLE} posts with numbers and ${thin === 1 ? "is" : "are"} not ranked yet.`);
  if (enough && confidenceOf(o.posts) === "low") out.push(confidenceNote(o.posts).text);
  out.push("Each platform is compared only with itself: numbers are never added up across platforms.");
  return out;
}

/**
 * The Monday summary of one overview. `previous` (last week's overview, when the caller kept one) only adds a line
 * about how many posts there were then; it never changes a measured claim.
 */
export function weeklyIntelligence(o: ReportOverview, previous?: Pick<ReportOverview, "posts" | "period"> | null): WeeklyIntelligence {
  const objective: Objective = isObjective(o.objective) ? o.objective : "engagement";
  const objectiveLabel = objectiveOptions().find((x) => x.id === objective)?.label ?? "Engagement";
  const posts = Number.isFinite(o.posts) ? Math.max(0, o.posts) : 0;
  const enough = hasEnoughPosts(posts);
  const movers = enough ? strongest(o.working).slice(0, REPORT_MAX_ITEMS).map(line) : [];
  const attention = enough ? strongest(o.attention).slice(0, REPORT_MAX_ITEMS).map(line) : [];
  const rec = enough ? (o.recommendations ?? [])[0] : undefined;
  const topRecommendation: ReportRecommendation | null = rec
    ? { title: clip(rec.title, TITLE_MAX), concept: clip(rec.concept, LINE_MAX), why: clip(rec.why, LINE_MAX), confidenceText: `${CONFIDENCE_WORD[rec.confidence]} from ${plural(rec.postsAnalyzed, "post")}`, href: createHref(rec.id) }
    : null;
  const headline = !enough
    ? `Not enough posts to compare yet: ${posts} of the ${MIN_SAMPLE} needed.`
    : movers.length
      ? movers[0].title
      : attention.length
        ? attention[0].title
        : "Steady: nothing moved far enough from the period before to call.";
  const versus = previous && Number.isFinite(previous.posts) ? `${plural(posts, "post")} with numbers this period, ${previous.posts.toLocaleString("en")} in ${previous.period?.label ?? "the one before"}.` : null;
  return {
    enough,
    headline,
    versus,
    movers,
    attention,
    topRecommendation,
    recommendationNote: enough && !rec ? (o.recommendationsReason ?? null) : null,
    posts,
    postsAnalyzed: Number.isFinite(o.postsAnalyzed) ? o.postsAnalyzed : 0,
    period: o.period?.label ?? "",
    objective,
    objectiveLabel,
    caveats: caveatsOf(o, objective, enough),
    emptyText: enough ? null : emptyStateText(posts, o.period?.days ?? 28),
  };
}
