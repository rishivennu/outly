/**
 * 1313: the international-first pricing revision. Every currency the site prices in gets an explicit price for
 * the three paid plans and the packs, INR and the revision-2 limits stay, yearly is ten months, and Apply /
 * Undo keep the same ordering guarantees as the earlier presets (nothing changes until an admin presses Apply).
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { normalizeTopups } from "../lib/billing/topups-core";
import { CURRENCIES } from "../lib/billing/money";
import { localPrice } from "../lib/billing/currency";

const realCache = require("next/cache");
mock.module("next/cache", () => ({ ...realCache, revalidatePath: () => {}, revalidateTag: () => {} }));

let db: typeof import("../lib/db").db;
let plans: typeof import("../lib/billing/plans");
let preset: typeof import("../lib/billing/pricing-preset");
let settings: typeof import("../lib/settings");
const actor = { login: "admin@outlly.test", role: "finance" } as const;
const status = async (p: Promise<unknown>) => p.then(() => 0, (e) => e as { status?: number; code?: string });
const PAID = ["starter", "creator", "pro-manager"] as const;
const FOREIGN = CURRENCIES.filter((c) => c !== "INR");

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  plans = await import("../lib/billing/plans");
  preset = await import("../lib/billing/pricing-preset");
  settings = await import("../lib/settings");
  await plans.ensurePlans();
  // a clean slate whatever an earlier run left behind
  await preset.undoPricingRevision3(actor);
  await preset.undoPricingRevision(actor);
  await preset.undoPricingPreset(actor);
});

afterAll(async () => {
  await preset.undoPricingRevision3(actor);
  await preset.undoPricingRevision(actor);
  await preset.undoPricingPreset(actor);
  await settings.saveConfig("topups", { enabled: false });
});

describe("1313 international pricing table", () => {
  test("every paid plan and pack names every non-INR currency, whole units, yearly = 10 months", () => {
    for (const p of preset.PRICING_2026_11_R3) {
      if (p.slug === "free") {
        expect(p.data.prices).toEqual({});
        continue;
      }
      expect(Object.keys(p.data.prices).sort()).toEqual([...FOREIGN].sort());
      for (const c of FOREIGN) {
        expect(p.data.prices[c] % 100).toBe(0);
        expect(p.data.yearlyPrices[c]).toBe(p.data.prices[c] * 10);
      }
    }
    for (const pack of preset.REVISION3_PACKS) expect(Object.keys(pack.prices ?? {}).sort()).toEqual([...FOREIGN].sort());
  });

  test("the headline prices and the INR / limits carried over from revision 2", () => {
    const by = Object.fromEntries(preset.PRICING_2026_11_R3.map((p) => [p.slug, p.data]));
    const r2 = Object.fromEntries(preset.PRICING_2026_11_R2.map((p) => [p.slug, p.data]));
    expect(by.starter.prices).toMatchObject({ USD: 900, EUR: 900, GBP: 800, CAD: 1200, AUD: 1400, SGD: 1200, AED: 3300 });
    expect(by.creator.prices).toMatchObject({ USD: 1900, EUR: 1900, GBP: 1600, CAD: 2600, AUD: 2900, SGD: 2600, AED: 7000 });
    expect(by["pro-manager"].prices).toMatchObject({ USD: 4900, EUR: 4900, GBP: 4200, CAD: 6600, AUD: 7500, SGD: 6600, AED: 18000 });
    for (const slug of PAID) {
      expect(by[slug].priceMinor).toBe(r2[slug].priceMinor);
      expect(by[slug].yearlyMinor).toBe(r2[slug].yearlyMinor);
      const { prices: _p, yearlyPrices: _y, note: _n, ...limits } = by[slug];
      const { prices: _p2, yearlyPrices: _y2, note: _n2, ...limits2 } = r2[slug];
      expect(limits).toEqual(limits2);
    }
    expect(by.creator.highlight).toBe(true);
  });

  test("regional prices sit within 10% of the USD price at the reference rates, so no region is accidentally cheap", () => {
    const rate = { EUR: 1.0, GBP: 0.85, CAD: 1.37, AUD: 1.52, SGD: 1.35, AED: 3.67 } as const;
    for (const p of preset.PRICING_2026_11_R3) {
      if (p.slug === "free") continue;
      const usd = p.data.prices.USD;
      for (const [c, r] of Object.entries(rate)) {
        const ratio = p.data.prices[c] / (usd * r);
        expect(ratio).toBeGreaterThan(0.9);
        expect(ratio).toBeLessThan(1.1);
      }
    }
  });

  test("a visitor in any currency gets the explicit price, never a conversion", () => {
    for (const p of preset.PRICING_2026_11_R3) {
      if (p.slug === "free") continue;
      const plan = { priceMinor: p.data.priceMinor, currency: "INR", prices: p.data.prices };
      for (const c of CURRENCIES) {
        const lp = localPrice(plan, c);
        expect(lp.converted).toBe(false);
        expect(lp.priceMinor).toBe(c === "INR" ? p.data.priceMinor : p.data.prices[c]);
      }
    }
  });
});

describe("1313 apply and undo", () => {
  const snap = async () => Object.fromEntries((await db.plan.findMany({ orderBy: { slug: "asc" } })).map(({ updatedAt: _u, ...r }) => [r.slug, r]));

  test("refused until the first preset is applied", async () => {
    expect(await preset.presetBackup()).toBeNull();
    expect(await status(preset.applyPricingRevision3(actor))).toMatchObject({ status: 409, code: "PRESET_MISSING" });
  });

  test("applies on top of the first preset without revision 2, writes every currency, and undo restores exactly", async () => {
    await preset.applyPricingPreset(actor, {});
    await settings.saveConfig("topups", { enabled: true, paidOnly: true } as never);
    const before = await snap();
    const packsBefore = normalizeTopups(await settings.getConfig("topups"));

    const r = await preset.applyPricingRevision3(actor);
    expect(r.changed).toEqual(["free", "starter", "creator", "pro-manager"]);
    const p = Object.fromEntries((await db.plan.findMany()).map((x) => [x.slug, x]));
    expect(JSON.parse(p.starter.prices)).toEqual({ USD: 900, EUR: 900, GBP: 800, CAD: 1200, AUD: 1400, SGD: 1200, AED: 3300 });
    expect(JSON.parse(p.creator.yearlyPrices)).toEqual({ USD: 19000, EUR: 19000, GBP: 16000, CAD: 26000, AUD: 29000, SGD: 26000, AED: 70000 });
    // revision-2 limits and INR arrive with it
    expect(p.starter).toMatchObject({ priceMinor: 37900, yearlyMinor: 379000, postLimit: 45, xPostLimit: 15, captionVideos: 25, aiMonthly: 60 });
    expect(p["pro-manager"]).toMatchObject({ priceMinor: 347900, postLimit: 600, seats: 5 });
    expect(p.creator.highlight).toBe(true);
    const t = normalizeTopups(await settings.getConfig("topups"));
    expect(t.enabled).toBe(true);
    expect(t.packs.map((x) => [x.id, x.prices?.CAD, x.prices?.AED])).toEqual([["ai-20", 400, 1100], ["x-50", 800, 2200], ["brand-1", 800, 2200], ["seat-1", 400, 1100]]);

    // the public plan prices in every currency without conversion
    const pub = (await plans.listPlans()).find((x: { slug: string }) => x.slug === "creator")!;
    for (const c of FOREIGN) expect(plans.inCurrency([pub], c)[0]).toMatchObject({ priceMinor: preset.CREATOR_R3[c], currency: c, converted: false });

    // ordering: nothing underneath can move while it is applied
    expect(await status(preset.applyPricingRevision3(actor))).toMatchObject({ status: 409, code: "PRESET_APPLIED" });
    expect(await status(preset.applyPricingRevision(actor))).toMatchObject({ status: 409, code: "REVISION3_APPLIED" });
    expect(await status(preset.undoPricingPreset(actor))).toMatchObject({ status: 409, code: "REVISION3_APPLIED" });

    const undo = await preset.undoPricingRevision3(actor);
    expect(undo.restored.sort()).toEqual(["creator", "free", "pro-manager", "starter"]);
    expect(await snap()).toEqual(before);
    expect(normalizeTopups(await settings.getConfig("topups"))).toEqual(packsBefore);
    expect(await preset.revision3Backup()).toBeNull();
    expect((await preset.undoPricingRevision3(actor)).restored).toEqual([]);
  });

  test("stacks on revision 2 and revision 2 cannot be undone underneath it", async () => {
    await preset.applyPricingRevision(actor);
    const r2 = await snap();
    await preset.applyPricingRevision3(actor);
    expect(await status(preset.undoPricingRevision(actor))).toMatchObject({ status: 409, code: "REVISION3_APPLIED" });
    await preset.undoPricingRevision3(actor);
    expect(await snap()).toEqual(r2);
    await preset.undoPricingRevision(actor);
    await preset.undoPricingPreset(actor);
    expect(await preset.presetBackup()).toBeNull();
  });
});
