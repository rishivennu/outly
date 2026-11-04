import { z } from "zod";
import { json } from "@/lib/http";
import { HttpError } from "@/lib/http";
import { adminRoute, adminEvent } from "@/lib/admin/route";
import { db } from "@/lib/db";
import { CURRENCIES } from "@/lib/billing/money";
import { campaignsState } from "@/lib/campaign";
import { ELIGIBILITY, LIMITS, MAX_PCT } from "@/lib/campaign-core";

export const dynamic = "force-dynamic";

export const GET = adminRoute("pricing", async () => json(await campaignsState()));

const slug = z.string().trim().regex(/^[a-z0-9-]{2,30}$/);
const Fields = z.object({
  title: z.string().trim().min(1).max(LIMITS.title),
  kind: z.enum(["pct", "fixed"]),
  value: z.number().int().min(1).max(100_000_000),
  currency: z.enum(CURRENCIES).default("INR"),
  planSlugs: z.array(slug).min(1).max(6),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  banner: z.object({
    badge: z.string().trim().max(LIMITS.badge).default(""),
    headline: z.string().trim().max(LIMITS.headline).default(""),
    body: z.string().trim().max(LIMITS.body).default(""),
    benefits: z.array(z.string().trim().max(LIMITS.benefit)).max(LIMITS.benefits).default([]),
    terms: z.string().trim().max(LIMITS.terms).default(""),
  }),
  ctaText: z.string().trim().min(1).max(LIMITS.cta),
  // A path inside the app only; checkout gets ?campaign=<id>&plan=<slug> added to it.
  ctaHref: z.string().trim().max(LIMITS.href).regex(/^\/(?![/\\])[A-Za-z0-9\-._~/?=&]*$/, "Use a path inside Outlly, like /billing"),
  eligibility: z.enum(ELIGIBILITY),
  active: z.boolean(),
  maxRedemptions: z.number().int().min(0).max(1_000_000),
});

const Post = z.discriminatedUnion("action", [
  Fields.extend({ action: z.literal("save"), id: z.string().min(1).max(40).optional() }),
  z.object({ action: z.literal("toggle"), id: z.string().min(1).max(40), active: z.boolean() }),
  z.object({ action: z.literal("delete"), id: z.string().min(1).max(40) }),
]);

async function check(f: z.infer<typeof Fields>) {
  if (f.kind === "pct" && f.value > MAX_PCT) throw new HttpError(400, `A percent offer can be at most ${MAX_PCT}% off.`, "BAD_VALUE");
  if (!(f.endsAt > f.startsAt)) throw new HttpError(400, "The offer must end after it starts.", "BAD_DATES");
  const plans = await db.plan.findMany({ where: { slug: { in: f.planSlugs } }, select: { slug: true, priceMinor: true } });
  const bad = f.planSlugs.filter((s) => !plans.some((p) => p.slug === s && p.priceMinor > 0));
  if (bad.length) throw new HttpError(400, `Not a paid plan: ${bad.join(", ")}.`, "BAD_PLAN");
}

/** Create / edit, switch on or off, delete. Prices are never stored: the offer is applied to the live plan price. */
export const POST = adminRoute("pricing", async (req, { admin }) => {
  const b = Post.parse(await req.json());
  if (b.action === "save") {
    const { action, id, ...f } = b;
    void action;
    await check(f);
    if (id && !(await db.campaign.findUnique({ where: { id }, select: { id: true } }))) throw new HttpError(404, "That offer is gone.", "NOT_FOUND");
    const data = { ...f, planSlugs: JSON.stringify(f.planSlugs), banner: JSON.stringify(f.banner) };
    const c = id ? await db.campaign.update({ where: { id }, data }) : await db.campaign.create({ data });
    await adminEvent("campaign", `${admin.name} ${id ? "edited" : "created"} the offer "${c.title}"`, f.active ? "on" : "off", "/admin/campaigns");
  } else if (b.action === "toggle") {
    if (!(await db.campaign.findUnique({ where: { id: b.id }, select: { id: true } }))) throw new HttpError(404, "That offer is gone.", "NOT_FOUND");
    const c = await db.campaign.update({ where: { id: b.id }, data: { active: b.active } });
    await adminEvent("campaign", `${admin.name} switched ${b.active ? "on" : "off"} the offer "${c.title}"`, undefined, "/admin/campaigns");
  } else {
    // An offer someone paid with stays on record (their payment points at it): end it instead.
    const c = await db.campaign.findUnique({ where: { id: b.id } });
    if (!c) throw new HttpError(404, "That offer is gone.", "NOT_FOUND");
    if (c.redemptions > 0) throw new HttpError(409, "People have paid with this offer, so it stays on record. Switch it off instead.", "IN_USE");
    await db.campaign.delete({ where: { id: b.id } });
    await adminEvent("campaign", `${admin.name} deleted the offer "${c.title}"`, undefined, "/admin/campaigns");
  }
  return json(await campaignsState());
}, [30, 60_000]);
