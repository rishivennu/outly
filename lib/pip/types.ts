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
] as const;
export type PipTool = (typeof PIP_TOOLS)[number];

export type PipCell = string | number | null;
export type PipColumn = { key: string; label: string; align?: "end"; mono?: boolean };
export type PipLink = { label: string; href: string; download?: boolean };
export type PipRow = { id: string; cells: Record<string, PipCell>; links?: PipLink[] };

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
  /** Enough to follow up on ("download them", "and in August?"). */
  ask: { tool: PipTool; period: string | null };
}
