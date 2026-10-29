import { z } from "zod";
import { PIP_TOOLS, type PipTool } from "./types";
import type { PipArgs, PipSort } from "./tools-core";

/**
 * Which of the person's own records a chat message asks for (1049). Deterministic keywords first; the model
 * is only asked when a message is clearly personal but no keyword fits, and its answer is validated against
 * the tool list. Dates are never taken from the model as dates: its `period` is text the range parser reads.
 * How-to questions and requests to CHANGE something go to the help bot, so Pip never acts on a guess.
 */
export type PipPlan = { tool: PipTool; args: PipArgs };
export type PipContext = { tool: PipTool; period?: string | null } | null | undefined;

const PERSONAL = /\b(my|mine|me|i|i've|i'd|ive|our|we)\b/i;
const RETRIEVE = /^\s*(please\s+)?(show|list|give|get|send|download|find|fetch|pull|export|see|view|display|how many|how much)\b/i;
const HOW_TO = /^\s*(how (do|can|should|would|does) (i|you|we|it|one)\b|how to\b|why\b|what (is|are|does) (a|an|the)\b|is there a way|explain)/i;
const ACTION = /\b(cancel|upgrade|downgrade|change|switch|delete|remove|edit|connect|disconnect|reset|refund me|get a refund|want a refund|request a refund|pause|resume|reschedule|retry|publish now|post this)\b/i;

const MONEY = "(?:₹|rs\\.?|inr|\\$|usd|€|eur|£|gbp)?\\s*([\\d,]+(?:\\.\\d+)?)\\s*(k|thousand|lakh|l)?\\b";
const num = (v: string, unit?: string) => {
  const n = Number(v.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const u = (unit ?? "").toLowerCase();
  return u === "k" || u === "thousand" ? n * 1000 : u === "lakh" || u === "l" ? n * 100000 : n;
};

export function amountBounds(text: string): Pick<PipArgs, "minAmount" | "maxAmount"> {
  const out: Pick<PipArgs, "minAmount" | "maxAmount"> = {};
  const between = new RegExp(`between\\s+${MONEY}\\s+(?:and|to|-)\\s+${MONEY}`, "i").exec(text);
  if (between) {
    out.minAmount = num(between[1], between[2]);
    out.maxAmount = num(between[3], between[4]);
    return out;
  }
  const min = new RegExp(`(?:above|over|more than|greater than|at least|bigger than|>=?)\\s*${MONEY}`, "i").exec(text);
  const max = new RegExp(`(?:below|under|less than|at most|smaller than|<=?)\\s*${MONEY}`, "i").exec(text);
  if (min) out.minAmount = num(min[1], min[2]);
  if (max) out.maxAmount = num(max[1], max[2]);
  return out;
}

const PLATFORM_WORDS: [RegExp, string][] = [
  [/\b(instagram|insta|ig|reels?)\b/i, "instagram"],
  [/\b(youtube|yt|shorts)\b/i, "youtube"],
  [/\b(twitter|tweets?|on x|x posts?)\b/i, "x"],
  [/\btiktok\b/i, "tiktok"],
  [/\bthreads\b/i, "threads"],
  [/\b(facebook|fb)\b/i, "facebook"],
  [/\blinkedin\b/i, "linkedin"],
];
const platformOf = (t: string) => PLATFORM_WORDS.find(([re]) => re.test(t))?.[1] ?? null;

function sortOf(t: string): PipSort | null {
  if (/\b(trending|trend|momentum|taking off|picking up|gaining)\b/i.test(t)) return "momentum";
  if (/\bengag/i.test(t)) return "engagement";
  if (/\b(top|best|most viewed|most views|popular|performing|performed)\b/i.test(t)) return "views";
  return null;
}

/** First match wins; order matters (a "refund without a credit note" is not a list of credit notes). */
function toolOf(t: string): PipTool | null {
  if (/\brefund/i.test(t) && /credit ?notes?/i.test(t) && /\b(missing|without|no|not|don't|dont|lack)\b/i.test(t)) return "refunds_missing_credit_note";
  if (/credit ?notes?/i.test(t)) return "credit_notes";
  if (/\b(invoices?|receipts?|bills?|gst)\b/i.test(t)) return "invoices";
  if (/\b(spend|spent|spending|expenses?|cost me|how much (did|have) (i|we) (pay|paid))\b/i.test(t)) return "spending";
  if (/\b(payments?|paid|charges?|charged|transactions?|orders?|purchases?|bought|refunds?|refunded)\b/i.test(t)) return "payments";
  if (/\bmy (current )?(plan|subscription)\b|\bsubscription\b|\b(renew|renewal|billing date)\b/i.test(t)) return "subscription";
  if (/\b(trending|top|best|popular|most viewed|best performing|performing|performed|viral)\b/i.test(t) && /\b(posts?|videos?|reels?|shorts|content|tweets?)\b/i.test(t)) return "top_posts";
  if (/\b(engagement|followers|reach|impressions|audience|growth|stats|analytics|insights)\b/i.test(t)) return "engagement";
  if (/\b(uploads?|uploaded|files?|media library|my videos)\b/i.test(t)) return "uploads";
  if (/\b(tickets?|support requests?|my requests|complaints?)\b/i.test(t)) return "tickets";
  if (/\b(notifications?|alerts?|notices?)\b/i.test(t)) return "notices";
  if (/\b(activity|recap|summary|summarise|summarize|what did i do|what have i done)\b/i.test(t)) return "activity";
  if (/\b(posts?|drafts?|scheduled|published|reels?|tweets?)\b/i.test(t)) return "posts";
  return null;
}

function statusOf(tool: PipTool, t: string): string | null {
  if (tool === "invoices") return /\brefund/i.test(t) ? "refunded" : /\bpaid\b|\bunrefunded\b/i.test(t) ? "paid" : null;
  if (tool === "payments") return /\bfail/i.test(t) ? "failed" : /\brefund/i.test(t) ? "refunded" : /\bpending\b/i.test(t) ? "pending" : /\b(successful|succeeded)\b/i.test(t) ? "succeeded" : null;
  if (tool === "posts") return /\bdrafts?\b/i.test(t) ? "draft" : /\bscheduled\b/i.test(t) ? "scheduled" : /\bfail/i.test(t) ? "failed" : /\bpublished|went live|live\b/i.test(t) ? "published" : null;
  if (tool === "tickets") return /\b(open|unresolved|pending)\b/i.test(t) ? "open" : /\b(resolved|closed)\b/i.test(t) ? "resolved" : null;
  if (tool === "notices") return /\bunread\b/i.test(t) ? "unread" : null;
  if (tool === "uploads") return /\bfail/i.test(t) ? "failed" : null;
  return null;
}

/** Is this a "show me my stuff" message rather than a how-to or a change request? */
export function wantsData(text: string) {
  return (PERSONAL.test(text) || RETRIEVE.test(text)) && !HOW_TO.test(text) && !ACTION.test(text);
}

export function keywordPlan(message: string): PipPlan | null {
  const t = message.trim();
  if (!wantsData(t)) return null;
  const tool = toolOf(t);
  if (!tool) return null;
  const top = /\btop\s+(\d{1,2})\b/i.exec(t);
  return {
    tool,
    args: {
      status: statusOf(tool, t),
      platform: platformOf(t),
      sort: tool === "top_posts" ? sortOf(t) : null,
      compare: /\b(compar|versus|vs\.?|than (last|the previous|before))/i.test(t),
      limit: top ? Number(top[1]) : null,
      ...(["invoices", "payments", "credit_notes"].includes(tool) ? amountBounds(t) : {}),
    },
  };
}

/** "And in August?" / "download them" right after a data card: same records, new dates. */
export function followUpPlan(message: string, ctx: PipContext, hasRange: boolean): PipPlan | null {
  if (!ctx || !PIP_TOOLS.includes(ctx.tool)) return null;
  const t = message.trim();
  if (t.length > 80 || ACTION.test(t.replace(/\bdownload\b/i, ""))) return null;
  if (hasRange) return { tool: ctx.tool, args: { period: t, compare: /\b(compar|versus|vs)/i.test(t) } };
  if (/\b(download|zip|pdfs?|them all|all of them|again|refresh)\b/i.test(t)) return { tool: ctx.tool, args: { period: ctx.period ?? null } };
  return null;
}

const Planned = z.object({
  tool: z.enum(PIP_TOOLS).nullable(),
  period: z.string().max(80).nullable().optional(),
  status: z.string().max(20).nullable().optional(),
  platform: z.string().max(20).nullable().optional(),
  minAmount: z.number().nonnegative().nullable().optional(),
  maxAmount: z.number().nonnegative().nullable().optional(),
  sort: z.enum(["views", "engagement", "momentum"]).nullable().optional(),
  compare: z.boolean().nullable().optional(),
});

export const PLAN_SYSTEM = `You route a creator's chat message to ONE read-only lookup of their own Outlly records, or none.
Tools: ${PIP_TOOLS.join(", ")}.
invoices = tax invoices / receipts. credit_notes = credit notes for refunds. payments = plan payments and refunds (Outlly sells plans only, no products or orders).
refunds_missing_credit_note = refunds that have no credit note. spending = how much they spent, by plan. subscription = their current plan and renewal.
posts = their posts (status draft|scheduled|published|failed). top_posts = their best or trending posts. engagement = views, followers, reach.
uploads = files they uploaded. tickets = their support requests. notices = notifications. activity = a recap of what they did.
Return JSON {"tool": one name or null, "period": the dates exactly as the person wrote them or null, "status", "platform", "minAmount", "maxAmount", "sort": "views"|"engagement"|"momentum"|null, "compare": boolean}.
Use null for tool when the message is a how-to question, asks to change or cancel something, or is not about their own records.`;

export function readPlan(raw: unknown): PipPlan | null {
  const p = Planned.safeParse(raw);
  if (!p.success || !p.data.tool) return null;
  const d = p.data;
  return {
    tool: d.tool!,
    args: { period: d.period ?? null, status: d.status ?? null, platform: d.platform ?? null, minAmount: d.minAmount ?? null, maxAmount: d.maxAmount ?? null, sort: d.sort ?? null, compare: d.compare ?? false },
  };
}
