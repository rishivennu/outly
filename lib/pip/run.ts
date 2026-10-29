import "server-only";
import { db } from "../db";
import { gemini } from "../ai/creative";
import { followUpPlan, keywordPlan, PLAN_SYSTEM, readPlan, wantsData, type PipContext, type PipPlan } from "./plan";
import { parseRange, safeTz } from "./range";
import { runTool, type PipCtx } from "./tools";
import type { PipResult } from "./types";

/**
 * Pip answering from someone's own records (1049): pick the lookup, run it (plain queries), log the access,
 * then let the model phrase ONLY the facts the query produced. A summary that brings in a number the facts
 * don't contain is thrown away for a plain sentence, so the money and counts on screen are never invented.
 */
export type PipUser = { id: string; timezone?: string | null; actor: { id: string } | null; scope: string[] | null };

export async function planFor(message: string, context: PipContext, tz: string, ai: () => Promise<boolean>): Promise<PipPlan | null> {
  const now = new Date();
  const follow = followUpPlan(message, context, !!parseRange(message, tz, now));
  const kw = keywordPlan(message);
  if (kw) return kw;
  if (follow) return follow;
  if (!wantsData(message) || !(await ai())) return null;
  const raw = await gemini<unknown>(PLAN_SYSTEM, message.slice(0, 600), { temperature: 0, timeoutMs: 6000 }).catch(() => null);
  return readPlan(raw);
}

/** Every number in the summary must already appear in the facts. */
export function numbersBacked(summary: string, facts: string[]) {
  const pool = facts.join(" ").replace(/,/g, "");
  return (summary.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) ?? []).every((n) => pool.includes(n));
}

export function plainSummary(r: PipResult) {
  if (!r.rows.length && !r.totals.length) return r.empty;
  return r.facts.slice(0, 3).join(" ");
}

const LANG_NAME: Record<string, string> = { hi: "Hindi", es: "Spanish", fr: "French", de: "German", pt: "Portuguese", ar: "Arabic", zh: "Chinese", ja: "Japanese", ru: "Russian", id: "Indonesian", bn: "Bengali" };

async function summarise(r: PipResult, message: string, lang: string, ai: boolean) {
  const plain = plainSummary(r);
  if (!ai || !r.facts.length) return plain;
  const language = LANG_NAME[lang] ? ` Write in ${LANG_NAME[lang]}.` : "";
  const system = `You are Pip, Outlly's helper. Answer the person's question in at most two short sentences (under 60 words) using ONLY the facts given. Never add numbers, dates, names or reasons that are not in the facts. No em dashes, no emoji, no markdown.${language} Return JSON {"text": string}.`;
  const prompt = `Question: ${message.slice(0, 400)}\nFacts:\n${r.facts.map((f) => `- ${f}`).join("\n")}${r.complete ? "" : "\n- The list is incomplete; say so."}`;
  const out = await gemini<{ text?: string }>(system, prompt, { temperature: 0.2, timeoutMs: 8000 }).catch(() => null);
  const text = typeof out?.text === "string" ? out.text.trim().replace(/\u2014/g, ", ") : "";
  return text && text.length <= 400 && numbersBacked(text, r.facts) ? text : plain;
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
