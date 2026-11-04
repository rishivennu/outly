import { z } from "zod";
import { createHash } from "node:crypto";
import { clientIp, json, route } from "@/lib/http";
import { answer, answerFaq } from "@/lib/support/bot";
import { LANG_IDS, resolveT } from "@/lib/i18n/support";
import { chargeAi } from "@/lib/ai-quota";
import { getCurrentUser, realUserId } from "@/lib/auth";
import { limitShared } from "@/lib/rate-limit";
import { env } from "@/lib/env";
import { planFor, runPip } from "@/lib/pip/run";
import { PIP_TOOLS } from "@/lib/pip/types";
import { wantsToResolve } from "@/lib/support/resolve";
import { openConversation, recordTurn } from "@/lib/support/conversations";

const Body = z.object({
  message: z.string().trim().min(1).max(800),
  /** Set when the person tapped a help question in the chat: answer that exact entry. */
  faqId: z.string().max(64).optional(),
  /** The page Pip was opened on, so answers can say "on this page". */
  page: z.string().max(120).optional(),
  lang: z.enum(LANG_IDS).default("en"),
  history: z.array(z.object({ role: z.enum(["user", "bot"]), text: z.string().max(2000) })).max(30).default([]),
  /** The last records card in this chat (1049), so "and in August?" means the same records. */
  data: z
    .object({
      tool: z.enum(PIP_TOOLS),
      period: z.string().max(200).nullable().optional(),
      /** 1123: the post the last card was about, so "why did it do better?" means that post. Ownership is re-checked. */
      focus: z.string().max(200).nullable().optional(),
    })
    .optional(),
  /** 1126: the conversation this message belongs to (signed in only). Ownership is checked on every message. */
  conversationId: z.string().max(40).optional(),
});

const DAY = 24 * 3600_000;

/**
 * May a signed-out visitor's message reach the model? (1027) The help chat is public and Gemini is billed,
 * and only signed-in people have a daily counter, so a script rotating IPs could run up the bill. Visitors
 * get a small per-IP allowance and share one daily pool; past either they still get answers, straight
 * from the help centre (keyword match) instead of the model. Shared across instances when Upstash is set.
 */
async function visitorMayUseAi(ip: string) {
  if (!env.AI_SUPPORT_ANON_PER_IP || !env.AI_SUPPORT_ANON_DAILY) return false;
  const who = createHash("sha256").update(ip).digest("hex").slice(0, 32);
  if (!(await limitShared(`pip-anon:${who}`, env.AI_SUPPORT_ANON_PER_IP, DAY)).ok) return false;
  return (await limitShared("pip-anon:all", env.AI_SUPPORT_ANON_DAILY, DAY)).ok;
}


export const POST = route(async (req) => {
  const b = Body.parse(await req.json());
  const askedAt = new Date();
  const me = await getCurrentUser();
  // 1126: a signed-in person's chat is written down, keyed to the person really signed in (a teammate's chat
  // is theirs). A resolved conversation refuses new messages here too, not only in the browser.
  const who = me ? realUserId(me) : null;
  const conv = who ? await openConversation(who, b.conversationId) : null;
  // Writes the turn and hands back the conversation id. Records cards (r.data) are never written down.
  // `shown` is the full text the person saw, when it differs from `answer` (the resolve offer adds its question).
  const reply = async <T extends { answer: string }>(out: T, shown?: string) => {
    if (!who) return json(out);
    try {
      const conversationId = await recordTurn({ userId: who, conversation: conv, question: b.message, answer: shown ?? out.answer, askedAt });
      return json({ ...out, conversationId });
    } catch (e) {
      console.error("[pip:record]", e);
      return json(out);
    }
  };
  // "I got the answer", "that's all, thanks": offer to resolve. Only an offer: nothing closes until they confirm.
  // Plain "thanks" isn't enough (lib/support/resolve.ts); visitors have no inbox on file, so they get the warm reply only.
  if (!b.faqId && wantsToResolve(b.message, b.history)) {
    const rt = resolveT(b.lang);
    return reply({ answer: me ? rt.reply : rt.visitor, confident: true, sources: [], wantsHuman: false, smalltalk: true, resolve: !!me }, `${rt.reply}\n\n${rt.ask}`);
  }
  // Charged only when a model call is about to happen (an English help-question tap never calls it).
  // Signed in: the per-person daily counter (throws 429 past it). Visitor: the free pool above.
  let allowed: boolean | undefined;
  const mayUseAi = async () => {
    if (allowed === undefined) {
      if (me) await chargeAi(realUserId(me), "support");
      allowed = me ? true : await visitorMayUseAi(clientIp(req));
    }
    return allowed;
  };
  const exact = b.faqId ? await answerFaq(b.faqId, b.lang, b.lang !== "en" && (await mayUseAi())) : null;
  if (exact) return reply(exact);
  // 1049: a signed-in person asking for their own records gets them from the database. Visitors never reach this.
  if (me && !b.faqId) {
    const plan = await planFor(b.message, b.data, me.timezone || "UTC", mayUseAi);
    if (plan) {
      const r = await runPip({ id: me.id, timezone: me.timezone, actor: me.actor, scope: me.scope }, plan, b.message, b.lang, mayUseAi);
      return reply({ answer: r.answer, confident: true, sources: [], wantsHuman: false, data: r.data });
    }
  }
  return reply(await answer(b.message, b.history, b.lang, { signedIn: !!me, page: b.page, ai: await mayUseAi() }));
}, { auth: false, limit: [30, 60_000] });
