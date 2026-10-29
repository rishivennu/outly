import "server-only";
import { parseRange, type DateRange } from "./range";
import { creditNotes, invoices, payments, refundsMissingCreditNote, spending, subscription } from "./tools-billing";
import { activity, engagement, notices, posts, tickets, topPosts, uploads } from "./tools-content";
import { base, type PipArgs, type PipCtx } from "./tools-core";
import type { PipResult, PipTool } from "./types";

export type { PipArgs, PipCtx } from "./tools-core";

/** Pip's data tools (1049). One entry per PIP_TOOLS name; every one is scoped to ctx.ownerId by the session. */
type Tool = (ctx: PipCtx, a: PipArgs, range: DateRange | null, period: string | null) => Promise<PipResult>;
const TOOLS: Record<PipTool, Tool> = {
  invoices,
  credit_notes: creditNotes,
  payments,
  refunds_missing_credit_note: refundsMissingCreditNote,
  spending,
  subscription,
  posts,
  top_posts: topPosts,
  engagement,
  uploads,
  tickets,
  notices,
  activity,
};

/** Money belongs to the workspace owner: a teammate gets a plain no, not a partial view. */
export const BILLING_TOOLS: readonly PipTool[] = ["invoices", "credit_notes", "payments", "refunds_missing_credit_note", "spending", "subscription"];

export async function runTool(tool: PipTool, ctx: PipCtx, a: PipArgs = {}): Promise<PipResult> {
  if (ctx.actorId && BILLING_TOOLS.includes(tool)) {
    const r = base(tool, "Billing is owner only", null, [], "Billing records belong to the workspace owner, so I can only show them to the owner. Ask them to check Billing.", null);
    r.facts.push("Billing records are only shown to the workspace owner.");
    return r;
  }
  // Dates always come from the parser, never from a model: an explicit period first, else the message itself.
  const text = (a.period ?? "").trim();
  let range = text ? parseRange(text, ctx.tz, ctx.now) : null;
  const unread = !!text && !range;
  if (!text) range = parseRange(ctx.message, ctx.tz, ctx.now);
  // "My activity" with no dates means the last 30 days, said out loud in the label.
  if (!range && tool === "activity") range = parseRange("last 30 days", ctx.tz, ctx.now);
  const period = text || (range ? ctx.message.slice(0, 160) : null);
  const r = await TOOLS[tool](ctx, a, range, period);
  if (unread) r.notes.unshift({ level: "warn", text: `I couldn't read the dates "${text.slice(0, 60)}", so this covers everything on record.` });
  return r;
}
