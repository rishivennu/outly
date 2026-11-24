import "server-only";
import { OBJECTIVES, type Objective, type Signal } from "../intelligence/core";
import { objectiveOptions } from "../intelligence/brand-core";
import { overview, type Overview } from "../intelligence/service";
import { CONFIDENCE_WORD, attentionEmptyText, emptyStateText, evidenceLine, formatLabel, hasEnoughPosts, platformLabel, statusWord, workingEmptyText } from "../../components/intelligence/view-core";
import { intelligencePulse } from "../intelligence/pulse";
import { baselineLine, clipperLine, platformName as pulsePlatformName, type IntelligencePulse } from "../intelligence/pulse-core";
import { LEVEL_LABEL } from "../intelligence/profile-core";
import { base, type PipArgs, type PipCtx } from "./tools-core";
import { windowFor } from "./tools-analytics";
import type { DateRange } from "./range";
import type { PipCard, PipResult, PipRow } from "./types";

/**
 * R1244: Pip's read-only view of Content Intelligence. It asks overview() in readOnly mode, so it never stores a
 * recommendation, writes an event, expires a row or calls AI wording, and it never acts on one. Every word for a
 * missing or impossible number is the dashboard's own (components/intelligence/view-core.ts).
 */

const TOP = 3;
const objectiveLabel = (o: Objective) => objectiveOptions().find((x) => x.id === o)?.label ?? o;
const signalLine = (s: Signal) => `${s.title}: ${evidenceLine(s.evidence)} (${CONFIDENCE_WORD[s.confidence].toLowerCase()}).`;

/** An objective the person named in their message ("for awareness"), else null so the saved one is used. */
export function objectiveIn(message: string): Objective | null {
  return OBJECTIVES.find((o) => new RegExp(`\\b${o}\\b`, "i").test(message)) ?? null;
}

/** The compact, deterministic summary: same overview in, same cards, rows and facts out. */
export function intelligenceSummary(o: Overview, days: number): { cards: PipCard[]; rows: PipRow[]; facts: string[]; empty: string } {
  const cards: PipCard[] = [
    { label: "Posts analysed", value: o.postsAnalyzed.toLocaleString("en") },
    { label: "Judged for", value: objectiveLabel(o.objective) },
    { label: "Recommendations", value: String(o.recommendations.length) },
  ];
  const rows: PipRow[] = [];
  const facts: string[] = [];
  const add = (section: string, lines: string[]) =>
    lines.forEach((finding, i) => {
      rows.push({ id: `${section}:${i}`, cells: { section: i ? "" : section, finding } });
      facts.push(`${section}: ${finding}`);
    });
  facts.push(`${o.postsAnalyzed} posts analysed (this period and the one before), judged for ${objectiveLabel(o.objective).toLowerCase()}.`);
  if (!hasEnoughPosts(o.posts)) return { cards, rows, facts, empty: emptyStateText(o.posts, days) };
  add("Working", o.working.length ? o.working.slice(0, TOP).map(signalLine) : [workingEmptyText]);
  add("Needs attention", o.attention.length ? o.attention.slice(0, TOP).map(signalLine) : [attentionEmptyText]);
  add(
    "Next",
    o.recommendations.length ? o.recommendations.slice(0, TOP).map((r) => `${r.title} (${CONFIDENCE_WORD[r.confidence].toLowerCase()}).`) : [o.recommendationsReason ?? "No recommendations yet."],
  );
  const gaps = o.formats.filter((g) => g.status !== "ok").slice(0, TOP);
  if (gaps.length) add("Not compared", gaps.map((g) => `${platformLabel(g.platform)} ${formatLabel(g.format).toLowerCase()}: ${statusWord(g)}.`));
  return { cards, rows, facts, empty: "" };
}

export async function intelligenceOverview(ctx: PipCtx, _a: PipArgs, range: DateRange | null, period: string | null): Promise<PipResult> {
  const w = await windowFor(ctx, range, 28);
  const days = Math.max(7, Math.min(90, w.days || 28));
  const r = base(
    "intelligence_overview",
    "Content Intelligence",
    w,
    [
      { key: "section", label: "Area" },
      { key: "finding", label: "What the numbers say" },
    ],
    "",
    period,
  );
  const o = await overview({ id: ctx.ownerId, scope: ctx.scope }, { days, objective: objectiveIn(ctx.message) ?? undefined, accountIds: ctx.scope, readOnly: true });
  const s = intelligenceSummary(o, days);
  r.cards = s.cards;
  r.rows = s.rows;
  r.facts = s.facts;
  r.empty = s.empty;
  r.found = r.returned = r.rows.length;
  if (w.cut) r.notes.push({ level: "info", text: w.cut });
  if (o.postsCapped) {
    r.complete = false;
    r.notes.push({ level: "warn", text: "This workspace has more posts than one read covers, so only the newest ones were compared." });
  }
  r.notes.push({ level: "info", text: "From your own published posts, compared like with like. A recommendation is a suggestion from your numbers, not proof of what causes growth." });
  r.downloads = [{ label: "Open Content Intelligence", href: "/intelligence" }];
  return r;
}

/* ------------------------------------------------------------------ R1325: Personal Intelligence + clipper */

const fmtViews = (n: number) => Math.round(n).toLocaleString("en");

/** The deterministic summary behind the `predictions` tool: one row per platform, the facts in the same words. */
export function predictionsSummary(p: IntelligencePulse | null, platform: string | null): { cards: PipCard[]; rows: PipRow[]; facts: string[]; empty: string } {
  const platforms = (p?.platforms ?? []).filter((x) => !platform || x.platform === platform);
  if (!platforms.length) {
    const empty = platform
      ? `Nothing measured on ${pulsePlatformName(platform)} yet, so no baseline there. One appears once a published post is a day old and has numbers.`
      : "Nothing measured yet, so no baseline. Baselines appear once a published post is a day old and has numbers (Instagram, YouTube or Facebook report them per post).";
    return { cards: [], rows: [], facts: [empty], empty };
  }
  const measured = platforms.reduce((s, x) => s + x.measured, 0);
  const cards: PipCard[] = [
    { label: "Measured posts", value: measured.toLocaleString("en"), hint: "Your own published posts with numbers, last 180 days." },
    { label: "Platforms", value: String(platforms.length) },
  ];
  const own = platforms.filter((x) => x.level === "personal").length;
  cards.push({ label: "On your own results", value: `${own} of ${platforms.length}`, hint: "Platforms with enough measured posts to be judged on your results alone." });
  const rows: PipRow[] = platforms.map((x) => ({
    id: x.platform,
    cells: {
      platform: pulsePlatformName(x.platform),
      format: x.top?.format ?? "—",
      typical: x.top ? `~${fmtViews(x.top.predicted)}` : null,
      range: x.top ? `${fmtViews(x.top.low)} to ${fmtViews(x.top.high)}` : null,
      sample: x.top ? (x.top.n ? `${x.top.n} of yours` : x.top.shared ? `${x.top.shared.n} cohort posts` : "—") : "—",
      level: LEVEL_LABEL[x.level],
    },
    links: [{ label: "Open", href: `/intelligence#intel-baselines` }],
  }));
  const facts = platforms.map(baselineLine);
  return { cards, rows, facts, empty: "" };
}

/** `predictions`: the creator's own baselines (R1319/R1324), read-only. A platform named in the message narrows it. */
export async function predictions(ctx: PipCtx, a: PipArgs, range: DateRange | null, period: string | null): Promise<PipResult> {
  const w = await windowFor(ctx, range, 28);
  const r = base(
    "predictions",
    "Your baselines",
    null,
    [
      { key: "platform", label: "Platform" },
      { key: "format", label: "Format" },
      { key: "typical", label: "Typical views", align: "end", mono: true },
      { key: "range", label: "Usually", align: "end", mono: true },
      { key: "sample", label: "Sample", align: "end" },
      { key: "level", label: "Judged on" },
    ],
    "",
    period,
  );
  const scopeKey = ctx.scope ? ctx.scope.slice().sort().join(",") : "";
  const p = await intelligencePulse(ctx.ownerId, { now: ctx.now.getTime(), scopeKey, targetIds: ctx.scope ? await targetIdsFor(ctx.ownerId, ctx.scope) : null });
  const s = predictionsSummary(p, a.platform ?? null);
  r.cards = s.cards;
  r.rows = s.rows;
  r.facts = s.facts;
  r.empty = s.empty;
  r.found = r.returned = r.rows.length;
  r.estimate = true;
  if (range) r.notes.push({ level: "info", text: `Baselines are read over the last 180 days of measured posts, not the period asked (${w.label}).` });
  r.notes.push({ level: "info", text: "An estimate from your past posts (or, with few of your own, from an anonymised cohort scaled to your size), shown with its sample. Never a promise." });
  r.downloads = [{ label: "Open your baselines", href: "/intelligence#intel-baselines" }];
  return r;
}

/** Destination ids a scoped teammate may read (their accounts' PostTargets). */
async function targetIdsFor(ownerId: string, accountIds: string[]): Promise<string[]> {
  const { db } = await import("../db");
  const rows = await db.postTarget.findMany({ where: { post: { userId: ownerId }, socialAccountId: { in: accountIds } }, select: { id: true }, take: 5000 });
  return rows.map((t) => t.id);
}

/** The deterministic summary behind `clipper_status`. */
export function clipperSummary(p: IntelligencePulse | null): { cards: PipCard[]; rows: PipRow[]; facts: string[]; empty: string } {
  const c = p?.clipper ?? null;
  if (!c) {
    const empty = "No clipper job yet. Upload a long video on the Clipper page and it finds the moments worth a short.";
    return { cards: [], rows: [], facts: [empty], empty };
  }
  const cards: PipCard[] = [
    { label: "Running", value: String(c.running) },
    { label: "Waiting for review", value: String(c.review) },
    { label: "Ready to post", value: String(c.readyToPost), hint: "Approved and rendered clips not yet made into a post." },
    { label: "Published", value: String(c.published) },
  ];
  const rows: PipRow[] = [
    { id: "running", cells: { state: "Running", count: c.running, meaning: "Transcribing or finding moments" } },
    { id: "review", cells: { state: "Waiting for review", count: c.review, meaning: "Candidates ready for you to approve" } },
    { id: "ready", cells: { state: "Ready to post", count: c.readyToPost, meaning: "Rendered clips with no post yet" } },
    { id: "published", cells: { state: "Published", count: c.published, meaning: "Clips that became a post" } },
    ...(c.failed ? [{ id: "failed", cells: { state: "Failed", count: c.failed, meaning: "Open the job to retry" } }] : []),
  ];
  return { cards, rows, facts: [clipperLine(c) ?? "Nothing in the clipper queue."], empty: "" };
}

/** `clipper_status`: the Shorts clipper's queue, read-only (R1321–R1323). */
export async function clipperStatus(ctx: PipCtx, _a: PipArgs, _range: DateRange | null, period: string | null): Promise<PipResult> {
  const r = base(
    "clipper_status",
    "Shorts clipper",
    null,
    [
      { key: "state", label: "State" },
      { key: "count", label: "Jobs / clips", align: "end", mono: true },
      { key: "meaning", label: "What it means" },
    ],
    "",
    period,
  );
  const p = await intelligencePulse(ctx.ownerId, { now: ctx.now.getTime() });
  const s = clipperSummary(p);
  r.cards = s.cards;
  r.rows = s.rows;
  r.facts = s.facts;
  r.empty = s.empty;
  r.found = r.returned = r.rows.length;
  r.notes.push({ level: "info", text: "Counts from your clipper jobs right now. Approving, editing and posting happen on the Clipper page." });
  r.downloads = [{ label: "Open the Clipper", href: "/clipper" }];
  return r;
}
