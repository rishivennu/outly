import "server-only";
import { db } from "../db";
import { HttpError } from "../http";
import { getConfig, saveConfig } from "../settings";
import { audit, type Actor } from "./access";
import { revalidatePricing, ensurePlans } from "./plans";
import { PERKS, serializePerks, type Perk } from "./plan-rules";
import { normalizeTopups, type TopUpPack } from "./topups-core";

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
    aiMonthly?: number; aiDaily?: number;
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

const FIELDS = ["name", "note", "priceMinor", "yearlyMinor", "prices", "yearlyPrices", "highlight", "sortOrder", "state", "postLimit", "postPeriod", "fairUsePosts", "xPostLimit", "captionVideos", "aiCaptions", "analyticsDays", "replyLimit", "seats", "accountLimit", "brandLimit", "platformLimit", "storageMb", "maxUploadMb", "burnCaptions", "perks", "features", "aiMonthly", "aiDaily"] as const;

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
  if (await revisionBackup()) throw new HttpError(409, "Undo the revised pricing first, then this one.", "REVISION_APPLIED");
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

// ------------------------------------------------------------------ 1112: revision 2 (unit economics, 3 Nov 2026)

/**
 * Outlly-Unit-Economics-2026-11.pdf: the first preset's prices lost money on heavy users. This revision moves
 * the same four plans to Rs379 / 979 / 3,479 ($8 / 17 / 43, yearly = 10 months) with hard monthly caps on
 * posts, X, AI captions and AI requests, takes X off Free (X bills per post), and reprices the packs. It runs
 * on top of the first preset (which must be applied), keeps its own backup, and Undo puts back exactly the
 * rows and packs it replaced. Existing subscribers keep the price they pay until they renew or change plan.
 */
export const REVISION_NAME = "pricing-2026-11-r2";
const REV_KEY = `preset-backup:${REVISION_NAME}`;

const STARTER_R2 = intl(800, 800, 700);
const CREATOR_R2 = intl(1700, 1700, 1400);
const AGENCY_R2 = intl(4300, 4300, 3600);

export const PRICING_2026_11_R2: PresetPlan[] = [
  {
    slug: "free",
    data: {
      name: "Free", note: "Try it on 3 platforms", priceMinor: 0, yearlyMinor: 0, prices: {}, yearlyPrices: {}, highlight: false, sortOrder: 0, state: "available",
      postLimit: 3, postPeriod: "week", fairUsePosts: 0, xPostLimit: -1, captionVideos: 3, aiCaptions: true, analyticsDays: 30, replyLimit: 10,
      seats: 0, accountLimit: 0, brandLimit: 0, platformLimit: 3, storageMb: 1024, maxUploadMb: 100, burnCaptions: false, perks: [], aiMonthly: 15, aiDaily: 5,
      features: ["Any 3 platforms (X is on paid plans)", "3 posts a week", "AI captions on 3 short videos a month", "15 AI requests a month", "1 GB of storage, 30 days of analytics"],
    },
  },
  {
    slug: "starter",
    data: {
      name: "Starter", note: "For one creator posting every day", priceMinor: 37900, yearlyMinor: 379000, prices: STARTER_R2, yearlyPrices: x10(STARTER_R2), highlight: false, sortOrder: 1, state: "available",
      postLimit: 45, postPeriod: "month", fairUsePosts: 0, xPostLimit: 15, captionVideos: 25, aiCaptions: true, analyticsDays: 90, replyLimit: 8,
      seats: 0, accountLimit: 0, brandLimit: 1, platformLimit: 0, storageMb: 5 * 1024, maxUploadMb: 500, burnCaptions: true, perks: ["weekly-digest"], aiMonthly: 60, aiDaily: 10,
      features: ["Every platform, 1 brand", "45 posts a month, 15 to X", "AI captions on 25 videos a month", "60 AI requests a month, 5 GB of storage", "90 days of analytics and a weekly digest"],
    },
  },
  {
    slug: "creator",
    data: {
      name: "Creator", note: "For creators who post everywhere, every day", priceMinor: 97900, yearlyMinor: 979000, prices: CREATOR_R2, yearlyPrices: x10(CREATOR_R2), highlight: true, sortOrder: 2, state: "available",
      postLimit: 150, postPeriod: "month", fairUsePosts: 0, xPostLimit: 40, captionVideos: 60, aiCaptions: true, analyticsDays: 365, replyLimit: 35,
      seats: 1, accountLimit: 0, brandLimit: 2, platformLimit: 0, storageMb: 25 * 1024, maxUploadMb: 1024, burnCaptions: true,
      perks: ["weekly-digest", "voice-memory", "csv-export", "ai-replies", "review-links"], aiMonthly: 200, aiDaily: 25,
      features: ["2 brands on every platform", "150 posts a month, 40 to X", "AI captions on 60 videos, in your voice", "200 AI requests a month, 25 GB of storage", "1 year of analytics, CSV export, 1 helper"],
    },
  },
  {
    slug: "pro-manager",
    data: {
      name: "Agency", note: "For agencies and managers", priceMinor: 347900, yearlyMinor: 3479000, prices: AGENCY_R2, yearlyPrices: x10(AGENCY_R2), highlight: false, sortOrder: 3, state: "available",
      postLimit: 600, postPeriod: "month", fairUsePosts: 0, xPostLimit: 150, captionVideos: 200, aiCaptions: true, analyticsDays: 730, replyLimit: 120,
      seats: 5, accountLimit: 0, brandLimit: 5, platformLimit: 0, storageMb: 100 * 1024, maxUploadMb: 2048, burnCaptions: true, perks: [...PERKS], aiMonthly: 600, aiDaily: 60,
      features: ["5 brands on every platform", "5 team seats with approvals", "600 posts a month, 150 to X", "AI captions on 200 videos, 600 AI requests", "2 years of analytics, client PDF reports, 100 GB"],
    },
  },
];

/** Packs priced from the cost model: X +50 at Rs449 (the old 100 for Rs199 lost Rs165 a pack). On/off and paid-only stay as the admin set them. */
export const REVISION_PACKS: TopUpPack[] = [
  { id: "ai-20", kind: "ai", units: 20, priceMinor: 14900, prices: { USD: 300, EUR: 300, GBP: 300 }, days: 90, label: "AI captions on 20 more videos", plans: [] },
  { id: "x-50", kind: "x", units: 50, priceMinor: 44900, prices: { USD: 600, EUR: 600, GBP: 500 }, days: 90, label: "50 more X posts", plans: [] },
  { id: "brand-1", kind: "brand", units: 1, priceMinor: 44900, prices: { USD: 600, EUR: 600, GBP: 500 }, days: 30, label: "1 extra brand for 30 days", plans: ["creator", "pro-manager"] },
  { id: "seat-1", kind: "seat", units: 1, priceMinor: 22900, prices: { USD: 300, EUR: 300, GBP: 300 }, days: 30, label: "1 extra team seat for 30 days", plans: ["pro-manager"] },
];

type RevBackup = { at: string; by: string; rows: { slug: string; before: Record<string, unknown> }[]; topups: unknown };

export async function revisionBackup() {
  const row = await db.setting.findUnique({ where: { key: REV_KEY } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as RevBackup;
  } catch {
    return null;
  }
}

const pickFields = (r: Record<string, unknown>) => Object.fromEntries(FIELDS.map((f) => [f, r[f]]));

export async function applyPricingRevision(actor: Actor) {
  if (!(await presetBackup())) throw new HttpError(409, "Apply the November 2026 pricing first; this revision updates those plans.", "PRESET_MISSING");
  if (await revisionBackup()) throw new HttpError(409, "The revised pricing is already applied. Undo it first to apply it again.", "PRESET_APPLIED");
  const slugs = PRICING_2026_11_R2.map((p) => p.slug);
  const current = await db.plan.findMany({ where: { slug: { in: slugs } } });
  const missing = slugs.filter((s) => !current.some((c) => c.slug === s));
  if (missing.length) throw new HttpError(409, `Plan ${missing.join(", ")} is missing. Apply the November 2026 pricing first.`, "PRESET_MISSING");
  const topups = normalizeTopups(await getConfig("topups"));
  const backup: RevBackup = { at: new Date().toISOString(), by: actor.login, rows: current.map((r) => ({ slug: r.slug, before: pickFields(r as unknown as Record<string, unknown>) })), topups };
  await db.setting.upsert({ where: { key: REV_KEY }, create: { key: REV_KEY, value: JSON.stringify(backup) }, update: { value: JSON.stringify(backup) } });
  await db.$transaction(async (tx) => {
    for (const p of PRICING_2026_11_R2) await tx.plan.update({ where: { id: current.find((c) => c.slug === p.slug)!.id }, data: toRow(p.data) });
    await tx.plan.updateMany({ where: { slug: { not: "creator" }, highlight: true }, data: { highlight: false } });
  });
  await saveConfig("topups", { ...topups, packs: REVISION_PACKS } as never);
  revalidatePricing();
  await audit({ actor, action: "pricing.preset", targetType: "config", targetId: REVISION_NAME, before: backup.rows.map((r) => ({ slug: r.slug, price: r.before.priceMinor })), after: { changed: slugs } });
  const { adminEvent } = await import("../admin/route");
  await adminEvent("plan_changed", `${actor.login} applied the revised November 2026 pricing`, "Starter 379, Creator 979, Agency 3,479 with monthly caps; X is off Free. Existing subscribers keep their price until renewal.", "/admin/pricing");
  return { changed: slugs };
}

export async function undoPricingRevision(actor: Actor) {
  const b = await revisionBackup();
  if (!b) return { restored: [] as string[] };
  const restored: string[] = [];
  for (const r of b.rows) {
    const plan = await db.plan.findUnique({ where: { slug: r.slug }, select: { id: true } });
    if (!plan) continue;
    await db.plan.update({ where: { id: plan.id }, data: r.before as never });
    restored.push(r.slug);
  }
  if (b.topups) await saveConfig("topups", b.topups as never);
  await db.setting.delete({ where: { key: REV_KEY } }).catch(() => {});
  revalidatePricing();
  await audit({ actor, action: "pricing.preset.undo", targetType: "config", targetId: REVISION_NAME, after: { restored } });
  return { restored };
}
