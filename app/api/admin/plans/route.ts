import { z } from "zod";
import { db } from "@/lib/db";
import { json, HttpError } from "@/lib/http";
import { adminRoute, adminEvent } from "@/lib/admin/route";
import { PlanInput } from "@/lib/admin/schemas";
import { listPlans, revalidatePricing } from "@/lib/billing/plans";

export const GET = adminRoute("pricing", async () => {
  const plans = await listPlans({ includeHidden: true });
  const counts = await db.subscription.groupBy({ by: ["planId"], where: { status: "active" }, _count: true });
  return json({ plans: plans.map((p) => ({ ...p, subscribers: counts.find((c) => c.planId === p.id)?._count ?? 0 })) });
});

export const POST = adminRoute("pricing", async (req, { admin }) => {
  const d = PlanInput.parse(await req.json());
  const slug = d.slug || d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "plan";
  if (await db.plan.findUnique({ where: { slug } })) throw new HttpError(409, `A plan with the slug "${slug}" already exists.`, "DUPLICATE");
  const p = await db.plan.create({ data: { ...d, slug, features: JSON.stringify(d.features), prices: JSON.stringify(d.prices) } });
  if (d.highlight) await db.plan.updateMany({ where: { id: { not: p.id } }, data: { highlight: false } });
  revalidatePricing();
  await adminEvent("plan_changed", `${admin.name} added the ${p.name} plan`, undefined, "/admin/pricing");
  return json({ plan: p });
});

export const dynamic = "force-dynamic";
