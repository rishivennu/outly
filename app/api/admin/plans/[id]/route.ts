import { db } from "@/lib/db";
import { json, HttpError } from "@/lib/http";
import { adminRoute, adminEvent } from "@/lib/admin/route";
import { PlanInput } from "@/lib/admin/schemas";
import { revalidatePricing } from "@/lib/billing/plans";
import { formatMoney } from "@/lib/billing/money";

export const PATCH = adminRoute<{ params: { id: string } }>("pricing", async (req, { params, admin }) => {
  const before = await db.plan.findUnique({ where: { id: params.id } });
  if (!before) throw new HttpError(404, "That plan no longer exists.", "NOT_FOUND");
  const d = PlanInput.partial().parse(await req.json());
  if (d.slug && d.slug !== before.slug) {
    if (await db.payment.count({ where: { planId: before.id } })) throw new HttpError(409, "This plan has payments, so its slug is locked. Links and records depend on it.", "SLUG_LOCKED");
    if (await db.plan.findUnique({ where: { slug: d.slug } })) throw new HttpError(409, `Slug "${d.slug}" is taken.`, "DUPLICATE");
  }
  const { features, prices, ...rest } = d;
  const p = await db.plan.update({ where: { id: params.id }, data: { ...rest, ...(features ? { features: JSON.stringify(features) } : {}), ...(prices ? { prices: JSON.stringify(prices) } : {}) } });
  if (d.highlight) await db.plan.updateMany({ where: { id: { not: p.id } }, data: { highlight: false } });
  revalidatePricing();
  const priceMoved = d.priceMinor !== undefined && d.priceMinor !== before.priceMinor;
  await adminEvent(
    "plan_changed",
    `${admin.name} updated ${p.name}`,
    priceMoved ? `${formatMoney(before.priceMinor, before.currency)} → ${formatMoney(p.priceMinor, p.currency)}. Existing subscribers keep their price.` : undefined,
    "/admin/pricing",
  );
  return json({ plan: p });
});

export const DELETE = adminRoute<{ params: { id: string } }>("pricing", async (_req, { params, admin }) => {
  const p = await db.plan.findUnique({ where: { id: params.id } });
  if (!p) return json({ ok: true });
  const used = (await db.subscription.count({ where: { planId: p.id } })) + (await db.payment.count({ where: { planId: p.id } }));
  if (used) throw new HttpError(409, "People have paid for this plan, so it can't be deleted. Set it to Hidden instead: it disappears from pricing and existing subscribers are untouched.", "IN_USE");
  await db.plan.delete({ where: { id: p.id } });
  revalidatePricing();
  await adminEvent("plan_changed", `${admin.name} deleted the ${p.name} plan`, undefined, "/admin/pricing");
  return json({ ok: true });
});
