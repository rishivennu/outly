import "server-only";
import { OBJECTIVES, type Objective, type Signal } from "../intelligence/core";
import { objectiveOptions } from "../intelligence/brand-core";
import { overview, type Overview } from "../intelligence/service";
import { CONFIDENCE_WORD, attentionEmptyText, emptyStateText, evidenceLine, formatLabel, hasEnoughPosts, platformLabel, statusWord, workingEmptyText } from "../../components/intelligence/view-core";
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
