import "server-only";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { cached, invalidate } from "../cache";
import { priceLabel, type Currency, type PublicPlan } from "./money";
import { localPrice, parsePrices } from "./currency";

const SEED = [
  { slug: "free", name: "Free", priceMinor: 0, note: "What you get today", highlight: false, sortOrder: 0,
    features: ["One workspace", "Uploads up to 50 MB per file", "Instagram Reels, YouTube Shorts and X", "AI captions, hooks, hashtags and titles", "Scheduling, statuses and retries"] },
  { slug: "creator", name: "Creator", priceMinor: 49900, note: "For one creator going faster", highlight: true, sortOrder: 1,
    features: ["Everything in Free", "Uploads up to 500 MB", "Higher AI generation limits", "Longer analytics history", "Priority support"] },
  { slug: "studio", name: "Studio", priceMinor: 149900, note: "For a creator plus the people who help", highlight: false, sortOrder: 2,
    features: ["Everything in Creator", "Multiple workspaces", "Shared media library", "Review links before publish", "Team roles"] },
];

export async function ensurePlans() {
  if ((await db.plan.count()) > 0) return;
  // upsert so two processes seeding at once can't collide on the unique slug
  for (const p of SEED) await db.plan.upsert({ where: { slug: p.slug }, update: {}, create: { ...p, currency: "INR", interval: "month", features: JSON.stringify(p.features) } }).catch(() => {});
}

type PlanRow = { id: string; slug: string; name: string; priceMinor: number; currency: string; interval: string; note: string; features: string; state: string; highlight: boolean; sortOrder: number; prices: string; yearlyMinor: number; postLimit: number; aiCaptions: boolean; seats: number };

export function toPublic(p: PlanRow): PublicPlan {
  let features: string[] = [];
  try {
    features = JSON.parse(p.features);
  } catch {}
  return {
    id: p.id, slug: p.slug, name: p.name, priceMinor: p.priceMinor, currency: p.currency, interval: p.interval, note: p.note,
    highlight: p.highlight, sortOrder: p.sortOrder, postLimit: p.postLimit, aiCaptions: p.aiCaptions, seats: p.seats,
    features,
    prices: parsePrices(p.prices),
    yearlyMinor: p.yearlyMinor ?? 0,
    state: (["available", "soon", "hidden"].includes(p.state) ? p.state : "available") as PublicPlan["state"],
  };
}

/** Plans priced for one visitor currency. Same shape, so every card renders unchanged. */
export function inCurrency(plans: PublicPlan[], target: Currency): (PublicPlan & { converted: boolean; baseLabel: string })[] {
  return plans.map((p) => {
    const lp = localPrice(p, target);
    return { ...p, priceMinor: lp.priceMinor, currency: lp.currency, converted: lp.converted, baseLabel: priceLabel(p) };
  });
}

export async function listPlans(opts: { includeHidden?: boolean } = {}): Promise<PublicPlan[]> {
  // Shared by every visitor: one read per 10 s per instance, however many people load pricing.
  const all = await cached("plans:all", 10_000, async () => {
    await ensurePlans();
    const rows = await db.plan.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    return rows.map(toPublic);
  });
  return all.filter((p) => opts.includeHidden || p.state !== "hidden");
}

/** Every surface that shows a price. Called after any plan edit so the change is live on the next request. */
export function revalidatePricing() {
  invalidate("plans:");
  for (const p of ["/", "/billing", "/help", "/admin/pricing"]) revalidatePath(p);
}
