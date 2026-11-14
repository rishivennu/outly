/** What Pip hands the chat when it answers from someone's own records (1049). Shared by server and widget. */
export const PIP_TOOLS = [
  "invoices",
  "credit_notes",
  "payments",
  "refunds_missing_credit_note",
  "spending",
  "subscription",
  "posts",
  "top_posts",
  "engagement",
  "uploads",
  "tickets",
  "notices",
  "activity",
  // 1123: analysis over the creator's own synced numbers (lib/pip/tools-analytics.ts).
  "overview",
  "compare_platforms",
  "trend",
  "consistency",
  "best_times",
  "formats",
  "segments",
  "schedule",
  "account",
  "post_insight",
  "forecast",
  "report",
] as const;
export type PipTool = (typeof PIP_TOOLS)[number];

export type PipCell = string | number | null;
export type PipColumn = { key: string; label: string; align?: "end"; mono?: boolean };
export type PipLink = { label: string; href: string; download?: boolean };
export type PipRow = { id: string; cells: Record<string, PipCell>; links?: PipLink[] };
/** A headline number (1123). kind "estimate" = a projection, shown with an Estimate badge, never as an actual. */
export type PipCard = { label: string; value: string; delta?: string | null; hint?: string; kind?: "actual" | "estimate" };
/** The analysis tools: their summaries may run longer than a plain lookup's. */
export const ANALYTIC_TOOLS: readonly PipTool[] = ["overview", "compare_platforms", "trend", "consistency", "best_times", "formats", "segments", "schedule", "account", "post_insight", "forecast", "report"];

export interface PipResult {
  tool: PipTool;
  title: string;
  /** The exact period searched, in the person's timezone. Null = everything on record. */
  range: { label: string; tz: string } | null;
  columns: PipColumn[];
  rows: PipRow[];
  /** How many records match, counted separately from the fetch. */
  found: number;
  /** How many came back. complete = every match came back and nothing failed. */
  returned: number;
  complete: boolean;
  totals: { label: string; value: string }[];
  notes: { level: "info" | "warn"; text: string }[];
  downloads: PipLink[];
  /** What to say when there are no rows. */
  empty: string;
  /** Short, true sentences built from the data: the only thing a summary may draw on. */
  facts: string[];
  /** Enough to follow up on ("download them", "and in August?", "why did it do better?"). */
  ask: { tool: PipTool; period: string | null; focus?: string | null };
  /** 1123: headline numbers, where the numbers came from, and whether any of it is a projection. No charts (user rule). */
  cards?: PipCard[];
  sources?: string[];
  estimate?: boolean;
  /** The post this answer is about, so a follow-up "why?" means that post. */
  focus?: { postId: string; title: string } | null;
  /** 1151: a sentence the answer must open with, word for word (e.g. why a comparison couldn't be completed). */
  lead?: string | null;
  /** 1151: when each account's numbers last synced successfully. stale = older than 30 minutes, i.e. cached, not live. */
  sync?: { at: string | null; stale: boolean; accounts: { name: string; platform: string; lastSuccessAt: string | null; stale: boolean }[] } | null;
}
