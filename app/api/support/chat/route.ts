import { z } from "zod";
import { createHash } from "node:crypto";
import { clientIp, json, route } from "@/lib/http";
import { answer, answerFaq } from "@/lib/support/bot";
import { LANG_IDS } from "@/lib/i18n/support";
import { chargeAi } from "@/lib/ai-quota";
import { getCurrentUser, realUserId } from "@/lib/auth";
import { limitShared } from "@/lib/rate-limit";
import { env } from "@/lib/env";

const Body = z.object({
  message: z.string().trim().min(1).max(800),
  /** Set when the person tapped a help question in the chat: answer that exact entry. */
  faqId: z.string().max(64).optional(),
  /** The page Pip was opened on, so answers can say "on this page". */
  page: z.string().max(120).optional(),
  lang: z.enum(LANG_IDS).default("en"),
  history: z.array(z.object({ role: z.enum(["user", "bot"]), text: z.string().max(2000) })).max(30).default([]),
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
  const me = await getCurrentUser();
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
  if (exact) return json(exact);
  return json(await answer(b.message, b.history, b.lang, { signedIn: !!me, page: b.page, ai: await mayUseAi() }));
}, { auth: false, limit: [30, 60_000] });
