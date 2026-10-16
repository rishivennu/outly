import { z } from "zod";
import { json, route } from "@/lib/http";
import { answer, answerFaq } from "@/lib/support/bot";
import { LANG_IDS } from "@/lib/i18n/support";
import { chargeAi } from "@/lib/ai-quota";
import { getCurrentUser, realUserId } from "@/lib/auth";

const Body = z.object({
  message: z.string().trim().min(1).max(800),
  /** Set when the person tapped a help question in the chat: answer that exact entry. */
  faqId: z.string().max(64).optional(),
  /** The page Pip was opened on, so answers can say "on this page". */
  page: z.string().max(120).optional(),
  lang: z.enum(LANG_IDS).default("en"),
  history: z.array(z.object({ role: z.enum(["user", "bot"]), text: z.string().max(2000) })).max(30).default([]),
});

export const POST = route(async (req) => {
  const b = Body.parse(await req.json());
  // Anyone can use the help chat, so only a signed-in person has a daily counter; visitors get the IP limit.
  const me = await getCurrentUser();
  if (me) await chargeAi(realUserId(me), "support");
  const exact = b.faqId ? await answerFaq(b.faqId, b.lang) : null;
  return json(exact ?? (await answer(b.message, b.history, b.lang, { signedIn: !!me, page: b.page })));
}, { auth: false, limit: [30, 60_000] });
