import { z } from "zod";
import { json, route, HttpError } from "@/lib/http";
import { db } from "@/lib/db";
import { surveyProblem } from "@/lib/billing/experiments-core";
import { PRICE_SURVEY } from "@/lib/billing/pricing-lab";
import { CURRENCIES } from "@/lib/billing/money";

const price = z.number().int().min(0).max(100_000_000);
const Body = z.object({
  tooCheap: price, cheap: price, expensive: price, tooExpensive: price,
  planSlug: z.string().regex(/^[a-z0-9-]{2,30}$/).optional(),
  currency: z.enum(CURRENCIES).optional(),
  note: z.string().max(500).optional(),
});

/** Has this person answered the price survey? (the billing card hides once they have) */
export const GET = route(async (_req, { user }) => {
  const r = await db.surveyResponse.findUnique({ where: { userId_survey: { userId: user.id, survey: PRICE_SURVEY } }, select: { createdAt: true } });
  return json({ survey: PRICE_SURVEY, answered: !!r, at: r?.createdAt ?? null });
});

/** Van Westendorp: four prices in minor units. One answer per person; answering again replaces it. */
export const POST = route(async (req, { user }) => {
  const b = Body.parse(await req.json());
  const problem = surveyProblem(b);
  if (problem) throw new HttpError(400, problem, "VALIDATION");
  const answers = JSON.stringify({ tooCheap: b.tooCheap, cheap: b.cheap, expensive: b.expensive, tooExpensive: b.tooExpensive, ...(b.note?.trim() ? { note: b.note.trim() } : {}) });
  const data = { planSlug: b.planSlug ?? "", currency: b.currency ?? "INR", answers };
  await db.surveyResponse.upsert({ where: { userId_survey: { userId: user.id, survey: PRICE_SURVEY } }, create: { userId: user.id, survey: PRICE_SURVEY, ...data }, update: data });
  return json({ ok: true });
}, { limit: [10, 60_000] });
