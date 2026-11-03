import "server-only";
import { db } from "../db";
import { HttpError } from "../http";
import { getConfig, saveConfig } from "../settings";
import { audit, type Actor } from "./access";
import { revalidatePricing, ensurePlans } from "./plans";
import { PERKS, serializePerks, type Perk } from "./plan-rules";

/**
 * The November 2026 pricing (Outlly-Pricing-Strategy-2026-11.pdf): Free / Starter / Creator / Agency, Studio
 * retired. It is never applied automatically: an admin presses "Apply" in Admin > Pricing. Applying it only
 * writes the fields below; currency, interval, existing subscriptions and payments are left as they are, and
 * people on Studio keep it (a hidden plan still works for whoever has it). The rows as they were before are
 * saved, so "Undo" puts them back.
 */
type PresetPlan = {
  slug: string;
  create?: { currency: string; interval: string };
  data: {
    name: string; note: string; priceMinor: number; yearlyMinor: number; prices: Record<string, number>; yearlyPrices: Record<string, number>;
    highlight: boolean; sortOrder: number; state: "available" | "hidden";
    postLimit: number; postPeriod: "week" | "month"; fairUsePosts: number; xPostLimit: number; captionVideos: number; aiCaptions: boolean;
    analyticsDays: number; replyLimit: number; seats: number; accountLimit: number; brandLimit: number; platformLimit: number;
    storageMb: number; maxUploadMb: number; burnCaptions: boolean; perks: Perk[]; features: string[];
  };
};

export const PRESET_NAME = "pricing-2026-11";
const BACKUP_KEY = `preset-backup:${PRESET_NAME}`;

const intl = (usd: number, eur: number, gbp: number) => ({ USD: usd, EUR: eur, GBP: gbp });
const x10 = (p: Record<string, number>) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v * 10]));

const STARTER = intl(700, 700, 600);
const CREATOR = intl(1500, 1500, 1300);
const AGENCY = intl(3900, 3900, 3300);

export const PRICING_2026_11: PresetPlan[] = [
  {
    slug: "free",
    data: {
      name: "Free", note: "Try it on 3 platforms", priceMinor: 0, yearlyMinor: 0, prices: {}, yearlyPrices: {}, highlight: false, sortOrder: 0, state: "available",
      postLimit: 3, postPeriod: "week", fairUsePosts: 0, xPostLimit: 4, captionVideos: 5, aiCaptions: true, analyticsDays: 30, replyLimit: 10,
      seats: 0, accountLimit: 0, brandLimit: 0, platformLimit: 3, storageMb: 1024, maxUploadMb: 100, burnCaptions: false, perks: [],
      features: ["Any 3 platforms", "3 posts a week, 4 to X a month", "AI captions on 5 videos a month", "1 GB of storage, 100 MB files", "30 days of analytics"],
    },
  },
  {
    slug: "starter",
    create: { currency: "INR", interval: "month" },
    data: {
      name: "Starter", note: "For one creator posting every day", priceMinor: 29900, yearlyMinor: 299000, prices: STARTER, yearlyPrices: x10(STARTER), highlight: false, sortOrder: 1, state: "available",
      postLimit: 40, postPeriod: "month", fairUsePosts: 0, xPostLimit: 30, captionVideos: 30, aiCaptions: true, analyticsDays: 90, replyLimit: 100,
      seats: 0, accountLimit: 0, brandLimit: 1, platformLimit: 0, storageMb: 5 * 1024, maxUploadMb: 500, burnCaptions: true, perks: ["weekly-digest"],
      features: ["Every platform, 1 brand", "40 posts a month, 30 to X", "AI captions on 30 videos a month", "5 GB of storage, burned captions", "90 days of analytics and a weekly digest"],
    },
  },
  {
    slug: "creator",
    data: {
      name: "Creator", note: "For creators who post everywhere, every day", priceMinor: 79900, yearlyMinor: 799000, prices: CREATOR, yearlyPrices: x10(CREATOR), highlight: true, sortOrder: 2, state: "available",
      postLimit: 0, postPeriod: "month", fairUsePosts: 300, xPostLimit: 100, captionVideos: 150, aiCaptions: true, analyticsDays: 365, replyLimit: 0,
      seats: 1, accountLimit: 0, brandLimit: 2, platformLimit: 0, storageMb: 25 * 1024, maxUploadMb: 1024, burnCaptions: true,
      perks: ["weekly-digest", "voice-memory", "csv-export", "ai-replies", "review-links"],
      features: ["2 brands on every platform", "Unlimited posts, 100 to X a month", "AI captions on 150 videos, in your voice", "1 year of analytics and CSV export", "1 helper, review links, AI replies"],
    },
  },
  {
    slug: "pro-manager",
    data: {
      name: "Agency", note: "For agencies and managers", priceMinor: 249900, yearlyMinor: 2499000, prices: AGENCY, yearlyPrices: x10(AGENCY), highlight: false, sortOrder: 3, state: "available",
      postLimit: 0, postPeriod: "month", fairUsePosts: 1000, xPostLimit: 300, captionVideos: 500, aiCaptions: true, analyticsDays: 730, replyLimit: 0,
      seats: 5, accountLimit: 0, brandLimit: 5, platformLimit: 0, storageMb: 100 * 1024, maxUploadMb: 2048, burnCaptions: true, perks: [...PERKS],
      features: ["5 brands on every platform", "5 team seats with approvals", "AI captions on 500 videos, 300 X posts", "2 years of analytics, client PDF reports", "100 GB of storage, spike alerts"],
    },
  },
];

/** Studio is retired: hidden from pricing, still honoured for everyone who has it. */
const RETIRE = ["studio"];

const FIELDS = ["name", "note", "priceMinor", "yearlyMinor", "prices", "yearlyPrices", "highlight", "sortOrder", "state", "postLimit", "postPeriod", "fairUsePosts", "xPostLimit", "captionVideos", "aiCaptions", "analyticsDays", "replyLimit", "seats", "accountLimit", "brandLimit", "platformLimit", "storageMb", "maxUploadMb", "burnCaptions", "perks", "features"] as const;

const toRow = (d: PresetPlan["data"]) => ({ ...d, prices: JSON.stringify(d.prices), yearlyPrices: JSON.stringify(d.yearlyPrices), perks: serializePerks(d.perks), features: JSON.stringify(d.features) });

type Backup = { at: string; by: string; rows: { slug: string; existed: boolean; before: Record<string, unknown> | null }[]; beta?: unknown; founding?: unknown };

/**
 * Applies the preset. `endBeta` turns off "Free during beta" and `enableFounding` opens the founding offer;
 * both are the admin's choice in the confirm dialog and both stay editable on their own panels afterwards.
 */
export async function applyPricingPreset(actor: Actor, opts: { endBeta?: boolean; enableFounding?: boolean } = {}) {
  // Applying twice would save the preset's own rows as the backup, and Undo could never reach the originals.
  if (await presetBackup()) throw new HttpError(409, "The November 2026 pricing is already applied. Undo it first to apply it again.", "PRESET_APPLIED");
  await ensurePlans();
  const slugs = [...PRICING_2026_11.map((p) => p.slug), ...RETIRE];
  const current = await db.plan.findMany({ where: { slug: { in: slugs } } });
  const pick = (r: (typeof current)[number]) => Object.fromEntries(FIELDS.map((f) => [f, (r as Record<string, unknown>)[f]]));
  const backup: Backup = {
    at: new Date().toISOString(), by: actor.login,
    rows: slugs.map((slug) => {
      const r = current.find((c) => c.slug === slug);
      return { slug, existed: !!r, before: r ? pick(r) : null };
    }),
  };
  if (opts.endBeta || opts.enableFounding) {
    const { getConfig } = await import("../settings");
    if (opts.endBeta) backup.beta = { enabled: (await getConfig("beta")).enabled };
    if (opts.enableFounding) backup.founding = { enabled: (await getConfig("founding")).enabled };
  }
  await db.setting.upsert({ where: { key: BACKUP_KEY }, create: { key: BACKUP_KEY, value: JSON.stringify(backup) }, update: { value: JSON.stringify(backup) } });

  const changed: string[] = [];
  await db.$transaction(async (tx) => {
    for (const p of PRICING_2026_11) {
      const data = toRow(p.data);
      const has = current.find((c) => c.slug === p.slug);
      if (has) await tx.plan.update({ where: { id: has.id }, data });
      else await tx.plan.create({ data: { slug: p.slug, currency: p.create?.currency ?? "INR", interval: p.create?.interval ?? "month", ...data } });
      changed.push(p.slug);
    }
    await tx.plan.updateMany({ where: { slug: { in: RETIRE } }, data: { state: "hidden", highlight: false } });
    // One highlighted card: Creator.
    await tx.plan.updateMany({ where: { slug: { not: "creator" }, highlight: true }, data: { highlight: false } });
  });
  if (opts.endBeta) await saveConfig("beta", { enabled: false });
  if (opts.enableFounding) await saveConfig("founding", { enabled: true });
  revalidatePricing();
  await audit({ actor, action: "pricing.preset", targetType: "config", targetId: PRESET_NAME, before: backup.rows.map((r) => ({ slug: r.slug, price: r.before?.priceMinor, state: r.before?.state })), after: { changed, retired: RETIRE, ...opts } });
  const { adminEvent } = await import("../admin/route");
  await adminEvent("plan_changed", `${actor.login} applied the November 2026 pricing`, "Free, Starter, Creator, Agency. Studio is hidden; people on it keep it. Existing subscribers keep their price until renewal.", "/admin/pricing");
  return { changed, retired: RETIRE };
}

/**
 * Wording the first release of this preset got wrong (2026-11-03): "AI videos" read as if Outlly makes videos (it
 * captions them), and "add more any time" promised brand packs that are off until an admin sells them. Plans that
 * were applied before the fix keep the old lines until an admin presses "Fix plan wording". Only these exact lines
 * change; anything an admin wrote stays.
 */
export const COPY_FIXES: readonly (readonly [string, string])[] = [
  ["AI on 150 videos, in your own voice", "AI captions on 150 videos, in your voice"],
  ["5 brands, add more any time", "5 brands on every platform"],
  ["500 AI videos, 300 X posts a month", "AI captions on 500 videos, 300 X posts"],
];
const OLD_PACK_LABEL = /^(\d+) more AI videos$/;

const fixLines = (raw: string) => {
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  let hit = false;
  const next = list.map((s) => {
    const to = COPY_FIXES.find(([from]) => from === s)?.[1];
    if (to) hit = true;
    return to ?? s;
  });
  return hit ? next : null;
};

/** Plans (and saved top-up packs) still showing the old wording. Empty = nothing to fix. */
export async function staleCopy() {
  const plans = await db.plan.findMany({ select: { slug: true, features: true } });
  const slugs = plans.filter((p) => fixLines(p.features)).map((p) => p.slug);
  const cfg = (await getConfig("topups")) as { packs?: { kind?: string; label?: string }[] } | null;
  const packs = (cfg?.packs ?? []).filter((p) => p?.kind === "ai" && typeof p.label === "string" && OLD_PACK_LABEL.test(p.label)).length;
  return { plans: slugs, packs };
}

/** Pressed by an admin: swap the old lines for the new ones, nothing else. Safe to press twice. */
export async function fixPresetCopy(actor: Actor) {
  const plans = await db.plan.findMany({ select: { id: true, slug: true, features: true } });
  const fixed: string[] = [];
  for (const p of plans) {
    const next = fixLines(p.features);
    if (!next) continue;
    await db.plan.update({ where: { id: p.id }, data: { features: JSON.stringify(next) } });
    fixed.push(p.slug);
  }
  const cfg = (await getConfig("topups")) as { packs?: { kind?: string; label?: string }[] } | null;
  let packs = 0;
  if (cfg?.packs?.length) {
    const nextPacks = cfg.packs.map((p) => {
      const m = p?.kind === "ai" && typeof p.label === "string" ? OLD_PACK_LABEL.exec(p.label) : null;
      if (!m) return p;
      packs++;
      return { ...p, label: `AI captions on ${m[1]} more videos` };
    });
    if (packs) await saveConfig("topups", { ...cfg, packs: nextPacks } as never);
  }
  if (fixed.length) revalidatePricing();
  await audit({ actor, action: "pricing.preset.copy", targetType: "config", targetId: PRESET_NAME, after: { fixed, packs } });
  return { fixed, packs };
}

/** Is there something to undo? */
export async function presetBackup() {
  const row = await db.setting.findUnique({ where: { key: BACKUP_KEY } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as Backup;
  } catch {
    return null;
  }
}

/**
 * Undo: every plan the preset touched gets its fields back. A plan the preset created (Starter) is deleted
 * when nobody has paid for it, else hidden, so no record ever points at a missing plan.
 */
export async function undoPricingPreset(actor: Actor) {
  const b = await presetBackup();
  if (!b) return { restored: [] as string[] };
  const restored: string[] = [];
  for (const r of b.rows) {
    const plan = await db.plan.findUnique({ where: { slug: r.slug }, select: { id: true } });
    if (!plan) continue;
    if (r.existed && r.before) {
      await db.plan.update({ where: { id: plan.id }, data: r.before as never });
      restored.push(r.slug);
    } else if (!r.existed) {
      const used = (await db.subscription.count({ where: { planId: plan.id } })) + (await db.payment.count({ where: { planId: plan.id } }));
      if (used) await db.plan.update({ where: { id: plan.id }, data: { state: "hidden", highlight: false } });
      else await db.plan.delete({ where: { id: plan.id } });
      restored.push(r.slug);
    }
  }
  if (b.beta) await saveConfig("beta", b.beta);
  if (b.founding) await saveConfig("founding", b.founding);
  await db.setting.delete({ where: { key: BACKUP_KEY } }).catch(() => {});
  revalidatePricing();
  await audit({ actor, action: "pricing.preset.undo", targetType: "config", targetId: PRESET_NAME, after: { restored } });
  return { restored };
}
