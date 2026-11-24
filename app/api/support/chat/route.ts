import { z } from "zod";
import { createHash } from "node:crypto";
import { clientIp, HttpError, json, route } from "@/lib/http";
import { answer, answerFaq } from "@/lib/support/bot";
import { LANG_IDS, resolveT } from "@/lib/i18n/support";
import { chargeAi } from "@/lib/ai-quota";
import { getCurrentUser, realUserId } from "@/lib/auth";
import { limitShared } from "@/lib/rate-limit";
import { env } from "@/lib/env";
import { planFor, runPip } from "@/lib/pip/run";
import { PIP_TOOLS } from "@/lib/pip/types";
import { asksForPastChats, asksForTranscript, wantsToResolve } from "@/lib/support/resolve";
import { openConversation, PAST_CHATS_TEXT, PAST_CHATS_VISITOR, recordTurn, TRANSCRIPTS_RETIRED_TEXT } from "@/lib/support/conversations";
import { customerSend, handoffLog, requestHuman } from "@/lib/support/live";
import { routeIntent } from "@/lib/support/intent";
import { conversationState } from "@/lib/support/live-core";

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
  /** R1184: the browser's own id for this message, so a retry after a dropped connection is never written twice. */
  cid: z.string().max(40).optional(),
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
  // R1194: what these words ask for, read before any answer is written. The conversation's stored mode wins:
  // a specialist in the chat > a waiting request > an explicit ask for a person > everything Pip answers.
  const { intent, repeat } = b.faqId ? { intent: "GENERAL" as const, repeat: false } : routeIntent(b.message, { mode: conv?.mode });
  // R1184 Live Assist: while the person waits for, or talks with, a support specialist, Pip stays silent.
  // The words go to the support team through the same conversation (and the same idempotent write), never the model.
  if (who && conv && (conv.mode === "waiting" || conv.mode === "human")) {
    const sent = await customerSend(who, { conversationId: conv.id, text: b.message, cid: b.cid });
    // Asked for a person again while already in the queue: counted (requestHuman writes the duplicate down and
    // returns the request already there), and the widget says "You're already in the support queue" once.
    const again = repeat && !sent.duplicate ? await requestHuman(who, { conversationId: conv.id, source: "chat", intent: b.message, repeat: true }) : null;
    return json({
      live: true, answer: "", confident: true, sources: [], wantsHuman: false, message: sent.message, duplicate: sent.duplicate, conversationId: conv.id,
      conversationState: conversationState(conv.mode, null),
      ...(again ? { handoff: "already", snapshot: again } : {}),
    });
  }
  // R1194: "Connect me with a support specialist", "connect me in chat", "I want to talk to a human": the handoff
  // starts here, on the server, with no further question. One request (idempotent), one stored confirmation line,
  // the team notified, the state WAITING_FOR_AGENT. Visitors have no account to hang a live chat on: Pip explains
  // the email route instead (bot.ts COPY.human) and the widget shows the form.
  if (who && intent === "HUMAN_SUPPORT_REQUEST") {
    handoffLog("intent", { userId: who, conversationId: conv?.id ?? null, from: conv ? "AI_ASSISTED" : "NEW", to: "HUMAN_SUPPORT_REQUESTED" });
    const r = await requestHuman(who, { conversationId: conv?.id, message: b.message, cid: b.cid, source: "chat", intent: b.message, repeat: !!conv });
    const own = r.messages.find((m) => m.role === "user" && b.cid && m.cid === b.cid) ?? null;
    return json({
      live: true, answer: "", confident: true, sources: [], wantsHuman: false, conversationId: r.conversationId, conversationState: r.conversationState,
      handoff: r.created ? "started" : "already", snapshot: r, message: own,
    });
  }
  // Writes the turn and hands back the conversation id. Records cards (r.data) are never written down.
  // `shown` is the full text the person saw, when it differs from `answer` (the resolve offer adds its question).
  // Every answer of Pip's carries the conversation's state too (R1194): AI_ASSISTED here, since anything waiting or
  // with a specialist returned above. (After a cancelled request the state is CANCELLED until the next answer, which is this one.)
  const reply = async <T extends { answer: string }>(out: T, shown?: string) => {
    if (!who) return json(out);
    try {
      const conversationId = await recordTurn({ userId: who, conversation: conv, question: b.message, answer: shown ?? out.answer, askedAt });
      return json({ ...out, conversationId, conversationState: conversationState(conv?.mode ?? "ai", null) });
    } catch (e) {
      console.error("[pip:record]", e);
      return json(out);
    }
  };
  // "I got the answer", "that's all, thanks": offer to resolve. Only an offer: nothing closes until they confirm.
  // Plain "thanks" isn't enough (lib/support/resolve.ts); visitors have no inbox on file, so they get the warm reply only.
  // 1151: "where are my old chats?" gets the real place in the studio, never a made-up "Chat History".
  if (!b.faqId && asksForPastChats(b.message))
    return reply({ answer: me ? PAST_CHATS_TEXT : PAST_CHATS_VISITOR, confident: true, sources: [], wantsHuman: false, smalltalk: true });
  // R1311: Resolve chat marks the conversation resolved on the server and keeps its history; no email is involved,
  // so the offer appears for anyone signed in. Asking for a transcript gets the one honest line (they are retired).
  const done = !b.faqId && wantsToResolve(b.message, b.history);
  const wantsCopy = !b.faqId && !done && asksForTranscript(b.message);
  if (done || wantsCopy) {
    const rt = resolveT(b.lang);
    const base = { confident: true, sources: [], wantsHuman: false, smalltalk: true };
    if (wantsCopy) return reply({ ...base, answer: TRANSCRIPTS_RETIRED_TEXT, resolve: false });
    if (!who) return reply({ ...base, answer: rt.visitor, resolve: false });
    return reply({ ...base, answer: rt.reply, resolve: true }, `${rt.reply}\n\n${rt.ask}`);
  }
  // Charged only when a model call is about to happen (an English help-question tap never calls it).
  // Signed in: the per-person daily counter (throws 429 past it). Visitor: the free pool above.
  let allowed: boolean | undefined;
  const mayUseAi = async () => {
    if (allowed === undefined) {
      // Past the daily allowance the chat keeps working without the model: help-centre answers, and plain
      // sentences over the person's own records. A visitor past the free pool is treated the same way, and
      // taking the help centre away from someone who has questions left would be the worst answer here.
      if (me)
        allowed = await chargeAi(realUserId(me), "support").then(
          () => true,
          (e) => {
            if (e instanceof HttpError && e.status === 429) return false;
            throw e;
          },
        );
      else allowed = await visitorMayUseAi(clientIp(req));
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
