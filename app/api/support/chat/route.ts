import { z } from "zod";
import { json, route } from "@/lib/http";
import { answer } from "@/lib/support/bot";
import { LANG_IDS } from "@/lib/i18n/support";

const Body = z.object({
  message: z.string().trim().min(1).max(800),
  lang: z.enum(LANG_IDS).default("en"),
  history: z.array(z.object({ role: z.enum(["user", "bot"]), text: z.string().max(2000) })).max(30).default([]),
});

export const POST = route(async (req) => {
  const b = Body.parse(await req.json());
  return json(await answer(b.message, b.history, b.lang));
}, { auth: false, limit: [30, 60_000] });
