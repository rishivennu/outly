import "server-only";
import { db } from "../db";
import { gemini } from "../ai/creative";
import { followUpPlan, keywordPlan, PLAN_SYSTEM, readPlan, wantsData, type PipContext, type PipPlan } from "./plan";
import { parseRange, safeTz } from "./range";
import { runTool, type PipCtx } from "./tools";
import { ANALYTIC_TOOLS, type PipResult } from "./types";

/**
 * Pip answering from someone's own records (1049): pick the lookup, run it (plain queries), log the access,
 * then let the model phrase ONLY the facts the query produced. A summary that brings in a number the facts
 * don't contain is thrown away for a plain sentence, so the money and counts on screen are never invented.
 */
export type PipUser = { id: string; timezone?: string | null; actor: { id: string } | null; scope: string[] | null };

export async function planFor(message: string, context: PipContext, tz: string, ai: () => Promise<boolean>): Promise<PipPlan | null> {
  const now = new Date();
  const follow = followUpPlan(message, context, !!parseRange(message, tz, now));
  // "Why did it do better?" about the post on the last card beats a fresh keyword match.
  if (follow?.tool === "post_insight" && follow.args.focus) return follow;
  const kw = keywordPlan(message);
  if (kw) return kw;
  if (follow) return follow;
  if (!wantsData(message) || !(await ai())) return null;
  const raw = await gemini<unknown>(PLAN_SYSTEM, message.slice(0, 600), { temperature: 0, timeoutMs: 6000 }).catch(() => null);
  return readPlan(raw);
}

const digits = (s: string) => (s.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter(Number.isFinite);

/**
 * Every number in the summary must be a number the facts really produced. Compared as whole numbers, not as
 * text: "7 invoices" used to pass because the digit 7 sits inside the "2027" of a date. A fact may be said as
 * it stands, rounded or cut to one decimal ("12.5%" told as "13%"); anything else counts as invented and the
 * plain sentence is used instead.
 */
export function numbersBacked(summary: string, facts: string[]) {
  const pool = digits(facts.join(" "));
  return digits(summary).every((n) => pool.some((p) => p === n || Math.round(p) === n || Math.trunc(p) === n || Math.round(p * 10) / 10 === n));
}

export function plainSummary(r: PipResult) {
  const lead = r.lead?.trim() || "";
  const rest = r.facts.filter((f) => f !== lead);
  if (!r.rows.length && !r.totals.length && !r.cards?.length) return lead || r.empty || rest.slice(0, 2).join(" ");
  const body = rest.slice(0, ANALYTIC_TOOLS.includes(r.tool) ? 4 : 3).join(" ");
  // 1151: a required opening (why a comparison is incomplete) always comes first, word for word.
  return lead ? `${lead}${body ? ` ${body}` : ""}` : body;
}

const LANG_NAME: Record<string, string> = { hi: "Hindi", es: "Spanish", fr: "French", de: "German", pt: "Portuguese", ar: "Arabic", zh: "Chinese", ja: "Japanese", ru: "Russian", id: "Indonesian", bn: "Bengali" };

async function summarise(r: PipResult, message: string, lang: string, ai: boolean) {
  const plain = plainSummary(r);
  const lead = r.lead?.trim() || "";
  const given = r.facts.filter((f) => f !== lead);
  // 1151: nothing to word beyond the required opening, so no model call.
  if (!ai || !given.length || (lead && !r.rows.length && !r.totals.length && !r.cards?.length)) return plain;
  const language = LANG_NAME[lang] ? ` Write in ${LANG_NAME[lang]}.` : "";
  // 1123: analysis answers may run longer, and must keep "estimate" and "not proven to cause" where the facts say so.
  const deep = ANALYTIC_TOOLS.includes(r.tool);
  const size = deep && (r.tool === "report" || r.facts.length > 4) ? "at most five short sentences (under 120 words); answer first, then the reasons" : "at most two short sentences (under 60 words)";
  const caveats = `${r.tool === "report" ? " Lead with the headline numbers (views, engagement); mention what needs more data only after them." : ""}${r.estimate ? " These are estimates: say so." : ""}${r.facts.some((f) => /not proven|don't prove|could be chance|could be normal/i.test(f)) ? " Never say one thing caused another; say they are linked." : ""}`;
  const system = `You are Pip, Outlly's helper. Answer the person's question in ${size} using ONLY the facts given. Never add numbers, dates, names or reasons that are not in the facts.${caveats} No em dashes, no emoji, no markdown.${language} Return JSON {"text": string}.`;
  const prompt = `Question: ${message.slice(0, 400)}${r.range ? `\nPeriod: ${r.range.label}` : ""}\nFacts:\n${given.map((f) => `- ${f}`).join("\n")}${r.complete ? "" : "\n- The list is incomplete; say so."}`;
  const out = await gemini<{ text?: string }>(system, prompt, { temperature: 0.2, timeoutMs: deep ? 10000 : 8000 }).catch(() => null);
  const text = typeof out?.text === "string" ? out.text.trim().replace(/\u2014/g, ", ") : "";
  const facts = r.range ? [...r.facts, r.range.label] : r.facts;
  const good = text && text.length <= (deep ? 900 : 400) && numbersBacked(text, facts) && !/\b(caused|because of)\b/i.test(text);
  if (!good) return plain;
  return lead && !text.startsWith(lead) ? `${lead} ${text}` : text;
}

export async function runPip(user: PipUser, plan: PipPlan, message: string, lang: string, ai: () => Promise<boolean>) {
  const ctx: PipCtx = { ownerId: user.id, actorId: user.actor?.id ?? null, scope: user.scope, tz: safeTz(user.timezone), now: new Date(), message };
  const result = await runTool(plan.tool, ctx, plan.args);
  // Audit trail: whose records, who asked, which lookup and filters, how much came back. Never the rows.
  await db.pipAccessLog
    .create({
      data: {
        userId: ctx.ownerId,
        actorId: ctx.actorId,
        tool: plan.tool,
        args: JSON.stringify({ ...plan.args, range: result.range?.label ?? null }).slice(0, 2000),
        found: result.found,
        complete: result.complete,
      },
    })
    .catch(() => {});
  const answer = await summarise(result, message, lang, await ai().catch(() => false));
  return { answer, data: result };
}
