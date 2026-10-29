import "server-only";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { cached, invalidate } from "../cache";
import { priceLabel, type Currency, type PublicPlan } from "./money";
import { localPrice, parsePrices } from "./currency";

const FREE_FEATURES = ["One workspace", "3 posts a week", "50 MB of storage", "Instagram Reels, YouTube Shorts and X", "AI captions on 2 videos a month", "10 inbox replies a week", "Scheduling, statuses and retries"];

/**
 * Total storage per plan (1052), in MB: everything the account has uploaded, across every device. Over it,
 * new uploads stop until files are deleted or the plan grows; nothing already uploaded is ever removed.
 */
export const STORAGE_MB: Record<string, number> = { free: 50, creator: 500, studio: 50 * 1024, "pro-manager": 100 * 1024 };
const STORAGE_MIGRATION_KEY = "migrate:storage-1052";
/** Feature lines 1052 rewrites, only while they still read what earlier versions shipped. */
const STORAGE_LINES: Record<string, { from?: string; to: string; after?: string; merge?: [string, string, string] }> = {
  free: { from: "Uploads up to 50 MB per file", to: "50 MB of storage" },
  creator: { from: "Uploads up to 500 MB", to: "500 MB of storage" },
  // Cards stay at 5 lines (1038): the new storage line takes the room of two lines folded into one.
  studio: { to: "50 GB of storage", after: "Everything in Creator", merge: ["Review links before publish", "Team roles", "Team roles and review links"] },
  "pro-manager": { to: "100 GB of storage", after: "Everything in Studio", merge: ["Up to 10 connected accounts", "5 team seats, access per account", "10 accounts, 5 team seats"] },
};

const SEED = [
  { slug: "free", name: "Free", priceMinor: 0, note: "What you get today", highlight: false, sortOrder: 0,
    postLimit: 3, postPeriod: "week", maxUploadMb: 50, replyLimit: 10, captionVideos: 2, burnCaptions: false, storageMb: STORAGE_MB.free,
    features: FREE_FEATURES },
  { slug: "creator", name: "Creator", priceMinor: 49900, note: "For one creator going faster", highlight: true, sortOrder: 1, storageMb: STORAGE_MB.creator,
    features: ["Everything in Free", "500 MB of storage", "Higher AI generation limits", "Longer analytics history", "Priority support"] },
  { slug: "studio", name: "Studio", priceMinor: 149900, note: "For a creator plus the people who help", highlight: false, sortOrder: 2, storageMb: STORAGE_MB.studio,
    features: ["Everything in Creator", "50 GB of storage", "Multiple workspaces", "Shared media library", "Team roles and review links"] },
];

/**
 * Pro (1037, named "Pro Multi-Account Manager" until 1038): for people running several accounts. Added to
 * existing databases by a one-time migration, so an admin who later edits or hides it is never overwritten.
 */
export const PRO_MANAGER = {
  slug: "pro-manager", name: "Pro", priceMinor: 249900, note: "For agencies and managers", highlight: false, sortOrder: 3,
  seats: 5, accountLimit: 10, prices: { USD: 2900 }, storageMb: STORAGE_MB["pro-manager"],
  features: ["Everything in Studio", "100 GB of storage", "10 accounts, 5 team seats", "Bulk schedule across accounts", "Client reports and spike alerts"],
};
const PRO_MIGRATION_KEY = "migrate:pro-manager-1037";
/** What 1037 shipped, so the 1038 rename only touches rows nobody has edited since. */
const PRO_1037 = {
  name: "Pro Multi-Account Manager", note: "For managers running 5 or more accounts",
  features: ["Everything in Studio", "Up to 10 connected accounts", "Switch profiles in one tap", "Bulk schedule across accounts", "Per-account team access", "Combined analytics with drilldown", "PDF and CSV client reports", "Spike and failed-post alerts"],
};
const PRO_RENAME_KEY = "migrate:pro-rename-1038";

const proRow = () => ({ ...PRO_MANAGER, currency: "INR", interval: "month", features: JSON.stringify(PRO_MANAGER.features), prices: JSON.stringify(PRO_MANAGER.prices) });

const FREE_MIGRATION_KEY = "migrate:free-limits-1026";

export async function ensurePlans() {
  if ((await db.plan.count()) > 0) {
    await migrateFreeLimits();
    await migrateProManager();
    await migrateProRename();
    return migrateStorage();
  }
  // upsert so two processes seeding at once can't collide on the unique slug
  for (const p of SEED) await db.plan.upsert({ where: { slug: p.slug }, update: {}, create: { ...p, currency: "INR", interval: "month", features: JSON.stringify(p.features) } }).catch(() => {});
  await db.plan.upsert({ where: { slug: PRO_MANAGER.slug }, update: {}, create: proRow() }).catch(() => {});
  await db.setting.create({ data: { key: PRO_MIGRATION_KEY, value: new Date().toISOString() } }).catch(() => {});
  await db.setting.create({ data: { key: PRO_RENAME_KEY, value: new Date().toISOString() } }).catch(() => {});
  // A fresh database is seeded with the current limits already, so the one-time migration is marked done here.
  // Otherwise the first ensurePlans() after seeding ran it and overwrote any Free limits an admin had set (1027).
  await db.setting.create({ data: { key: FREE_MIGRATION_KEY, value: new Date().toISOString() } }).catch(() => {});
  await db.setting.create({ data: { key: STORAGE_MIGRATION_KEY, value: new Date().toISOString() } }).catch(() => {});
}

/** The storage line a feature list should have (pure, tested). Leaves a list an admin rewrote alone. */
export function storageFeatures(slug: string, features: string[]) {
  const l = STORAGE_LINES[slug];
  if (!l || features.includes(l.to)) return features;
  if (l.from) return features.includes(l.from) ? features.map((f) => (f === l.from ? l.to : f)) : features;
  const at = l.after ? features.indexOf(l.after) : -1;
  if (at < 0) return features;
  let out = [...features.slice(0, at + 1), l.to, ...features.slice(at + 1)];
  if (l.merge && out.includes(l.merge[0]) && out.includes(l.merge[1])) {
    const [a, b, into] = l.merge;
    out = out.filter((f) => f !== b).map((f) => (f === a ? into : f));
  }
  return out;
}

/** One-time (1052): existing plans get their storage allowance and the matching feature line. */
async function migrateStorage() {
  const key = STORAGE_MIGRATION_KEY;
  if (await db.setting.findUnique({ where: { key }, select: { key: true } })) return;
  const won = await db.setting.create({ data: { key, value: new Date().toISOString() } }).then(() => true, () => false);
  if (!won) return;
  for (const [slug, mb] of Object.entries(STORAGE_MB)) {
    const row = await db.plan.findUnique({ where: { slug }, select: { id: true, features: true, storageMb: true } });
    if (!row) continue;
    let list: string[] = [];
    try { list = JSON.parse(row.features); } catch { /* keep [] */ }
    const next = storageFeatures(slug, Array.isArray(list) ? list : []);
    await db.plan.update({ where: { id: row.id }, data: { ...(row.storageMb ? {} : { storageMb: mb }), features: JSON.stringify(next) } });
  }
  invalidate("plans:");
}

/** One-time: existing databases get the 2026-10 Free limits. Admin can change them afterwards in Pricing. */
async function migrateFreeLimits() {
  const key = FREE_MIGRATION_KEY;
  if (await db.setting.findUnique({ where: { key }, select: { key: true } })) return;
  const won = await db.setting.create({ data: { key, value: new Date().toISOString() } }).then(() => true, () => false);
  if (!won) return;
  await db.plan.updateMany({
    where: { slug: "free" },
    data: { postLimit: 3, postPeriod: "week", maxUploadMb: 50, replyLimit: 10, captionVideos: 2, burnCaptions: false, features: JSON.stringify(FREE_FEATURES) },
  });
  invalidate("plans:");
}

/** One-time (1037): existing databases get the Pro Multi-Account Manager plan. A slug already taken is left alone. */
async function migrateProManager() {
  const key = PRO_MIGRATION_KEY;
  if (await db.setting.findUnique({ where: { key }, select: { key: true } })) return;
  const won = await db.setting.create({ data: { key, value: new Date().toISOString() } }).then(() => true, () => false);
  if (!won) return;
  await db.plan.upsert({ where: { slug: PRO_MANAGER.slug }, update: {}, create: proRow() }).catch(() => {});
  invalidate("plans:");
}

/**
 * One-time (1038): "Pro Multi-Account Manager" becomes "Pro" with a shorter list. Each field changes only
 * while it still reads exactly what 1037 shipped, so anything an admin typed in Pricing is kept.
 */
async function migrateProRename() {
  const key = PRO_RENAME_KEY;
  if (await db.setting.findUnique({ where: { key }, select: { key: true } })) return;
  const won = await db.setting.create({ data: { key, value: new Date().toISOString() } }).then(() => true, () => false);
  if (!won) return;
  const where = { slug: PRO_MANAGER.slug };
  await db.plan.updateMany({ where: { ...where, name: PRO_1037.name }, data: { name: PRO_MANAGER.name } });
  await db.plan.updateMany({ where: { ...where, note: PRO_1037.note }, data: { note: PRO_MANAGER.note } });
  await db.plan.updateMany({ where: { ...where, features: JSON.stringify(PRO_1037.features) }, data: { features: JSON.stringify(PRO_MANAGER.features) } });
  invalidate("plans:");
}

type PlanRow = { id: string; slug: string; name: string; priceMinor: number; currency: string; interval: string; note: string; features: string; state: string; highlight: boolean; sortOrder: number; prices: string; yearlyMinor: number; postLimit: number; aiCaptions: boolean; seats: number; postPeriod: string; maxUploadMb: number; replyLimit: number; captionVideos: number; burnCaptions: boolean; accountLimit?: number; storageMb?: number };

export function toPublic(p: PlanRow): PublicPlan {
  let features: string[] = [];
  try {
    features = JSON.parse(p.features);
  } catch {}
  return {
    id: p.id, slug: p.slug, name: p.name, priceMinor: p.priceMinor, currency: p.currency, interval: p.interval, note: p.note,
    highlight: p.highlight, sortOrder: p.sortOrder, postLimit: p.postLimit, aiCaptions: p.aiCaptions, seats: p.seats,
    postPeriod: p.postPeriod === "week" ? "week" : "month", maxUploadMb: p.maxUploadMb ?? 0, replyLimit: p.replyLimit ?? 0, captionVideos: p.captionVideos ?? 0, burnCaptions: p.burnCaptions ?? true, accountLimit: p.accountLimit ?? 0, storageMb: p.storageMb ?? 0,
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
