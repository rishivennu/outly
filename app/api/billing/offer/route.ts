import { z } from "zod";
import { db } from "@/lib/db";
import { json, route } from "@/lib/http";
import { requestCurrency } from "@/lib/billing/visitor";
import { getPolicy } from "@/lib/subscriptions/policy";
import { quote } from "@/lib/subscriptions/eligibility";
import { budgetState } from "@/lib/subscriptions/costs";
import { trialState } from "@/lib/subscriptions/trial";
import { deviceIdFromRequest } from "@/lib/subscriptions/signals";

export const dynamic = "force-dynamic";

const Query = z.object({ cycle: z.enum(["month", "year"]).optional(), plan: z.string().trim().min(1).max(40).optional() });

/**
 * 1147: what the signed-in person would pay for each paid plan right now (the same quote() checkout charges),
 * their monthly cost budget and their trial. The currency is always the location one, never the client's pick.
 */
export const GET = route(async (req, { user }) => {
  const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const currency = requestCurrency(req).currency;
  const deviceId = deviceIdFromRequest(req);
  const plans = await db.plan.findMany({ where: { state: "available", priceMinor: { gt: 0 }, ...(q.plan ? { slug: q.plan } : {}) }, orderBy: { priceMinor: "asc" }, select: { slug: true } });
  const [policy, quotes, budget, trial] = await Promise.all([
    getPolicy(),
    Promise.all(plans.map((p) => quote({ userId: user.id, planSlug: p.slug, currency, interval: q.cycle ?? "month", deviceId }))),
    budgetState(user.id),
    trialState(user.id),
  ]);
  return json(
    { policy: { enabled: policy.enabled, trialDays: policy.trialDays, graceDays: policy.graceDays }, quotes, budget, trial },
    { headers: { "cache-control": "private, no-store" } },
  );
}, { limit: [60, 60_000] });
