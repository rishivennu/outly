import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { bestOffer, claimHref, eligible, endsIn, funnel, liveState, offerLabel, offerPrice, parseBanner, parseSlugs, quietPath, savingLabel, CLIENT_EVENTS, MAX_PCT } from "@/lib/campaign-core";

// Round 1122: admin-managed promo offers and the bottom-sheet popup.
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const day = 86_400_000;
const now = new Date("2026-11-04T10:00:00Z");
const base = { active: true, startsAt: new Date(now.getTime() - day), endsAt: new Date(now.getTime() + day), maxRedemptions: 0, redemptions: 0, kind: "pct", value: 46, planSlugs: '["pro"]' };

describe("offer state (1122)", () => {
  test("live only when on, started, not ended, not sold out and valid", () => {
    expect(liveState(base, now)).toBe("live");
    expect(liveState({ ...base, active: false }, now)).toBe("off");
    expect(liveState({ ...base, startsAt: new Date(now.getTime() + 1000) }, now)).toBe("scheduled");
    expect(liveState({ ...base, endsAt: now }, now)).toBe("ended");
    expect(liveState({ ...base, maxRedemptions: 5, redemptions: 5 }, now)).toBe("sold-out");
    expect(liveState({ ...base, maxRedemptions: 5, redemptions: 4 }, now)).toBe("live");
  });
  test("bad offers are invalid, never live", () => {
    expect(liveState({ ...base, value: 0 }, now)).toBe("invalid");
    expect(liveState({ ...base, value: MAX_PCT + 1 }, now)).toBe("invalid");
    expect(liveState({ ...base, value: 12.5 }, now)).toBe("invalid");
    expect(liveState({ ...base, kind: "free" }, now)).toBe("invalid");
    expect(liveState({ ...base, planSlugs: "[]" }, now)).toBe("invalid");
    expect(liveState({ ...base, planSlugs: "not json" }, now)).toBe("invalid");
    expect(liveState({ ...base, startsAt: base.endsAt }, now)).toBe("invalid");
  });
  test("an expired offer reads as ended even if still switched on", () => {
    expect(liveState({ ...base, endsAt: new Date(now.getTime() - 1) }, now)).toBe("ended");
    expect(endsIn(new Date(now.getTime() - 1), now)).toBe("Ended");
    expect(endsIn(new Date(now.getTime() + 2 * day + 5), now)).toBe("Ends in 2 days");
    expect(endsIn(new Date(now.getTime() + 3_600_000), now)).toBe("Ends in 1 hour");
  });
});

describe("eligibility (1122)", () => {
  const fresh = { paying: false, everPaid: false, joinedAt: new Date(now.getTime() - 3 * day) };
  const old = { ...fresh, joinedAt: new Date(now.getTime() - 40 * day) };
  const payer = { paying: true, everPaid: true, joinedAt: old.joinedAt };
  const lapsed = { paying: false, everPaid: true, joinedAt: old.joinedAt };
  test("rules", () => {
    expect([fresh, old, payer, lapsed].map((w) => eligible("all", w, now))).toEqual([true, true, true, true]);
    expect([fresh, old, payer, lapsed].map((w) => eligible("free", w, now))).toEqual([true, true, false, true]);
    expect([fresh, old, payer, lapsed].map((w) => eligible("new", w, now))).toEqual([true, false, false, false]);
    expect([fresh, old, payer, lapsed].map((w) => eligible("lapsed", w, now))).toEqual([false, false, false, true]);
    expect(eligible("vip", fresh, now)).toBe(false);
  });
});

describe("offer pricing (1122)", () => {
  const pct = { kind: "pct", value: 46, currency: "INR" };
  test("percent rounds down to a whole unit and is always lower than the original", () => {
    expect(offerPrice(pct, 99_900, "INR")).toBe(53_900); // 999 * .54 = 539.46 -> 539
    for (const orig of [101, 250, 9_900, 49_900, 1_23_456]) {
      for (const v of [1, 10, 46, 90]) {
        const p = offerPrice({ ...pct, value: v }, orig, "INR");
        if (p !== null) {
          expect(p).toBeGreaterThanOrEqual(100);
          expect(p).toBeLessThan(orig);
        }
      }
    }
  });
  test("never below the minimum charge, null when nothing is saved", () => {
    expect(offerPrice({ kind: "fixed", value: 1_000_000, currency: "INR" }, 99_900, "INR")).toBe(100);
    expect(offerPrice(pct, 100, "INR")).toBeNull();
    expect(offerPrice({ ...pct, value: 1 }, 150, "INR")).toBe(100); // rounds down to a whole unit, never below 100
  });
  test("fixed offers only apply in their own currency", () => {
    const fixed = { kind: "fixed", value: 20_000, currency: "INR" };
    expect(offerPrice(fixed, 99_900, "INR")).toBe(79_900);
    expect(offerPrice(fixed, 1_200, "USD")).toBeNull();
    expect(offerPrice(pct, 1_200, "USD")).toBe(600); // 12 * .54 = 6.48 -> 6
  });
  test("no stacking with founding: the lower price wins", () => {
    expect(bestOffer(pct, 99_900, 69_900, "INR")).toBe(53_900);
    expect(bestOffer({ ...pct, value: 20 }, 99_900, 69_900, "INR")).toBeNull(); // 799 > founding 699
    expect(bestOffer(pct, 99_900, 99_900, "INR")).toBe(53_900);
  });
  test("labels", () => {
    expect(offerLabel(pct)).toBe("46% OFF");
    expect(offerLabel({ kind: "fixed", value: 20_000, currency: "INR" })).toMatch(/200 OFF$/);
  });
});

describe("parsing and links (1122)", () => {
  test("banner and slugs are cleaned", () => {
    const b = parseBanner(JSON.stringify({ badge: " Flash Sale ", headline: "x".repeat(99), benefits: ["a", 3, "", "b", "c", "d", "e"], terms: 7 }));
    expect(b.badge).toBe("Flash Sale");
    expect(b.headline.length).toBe(40);
    expect(b.benefits).toEqual(["a", "b", "c", "d"]);
    expect(b.terms).toBe("");
    expect(parseBanner("[1]")).toEqual({ badge: "", headline: "", body: "", benefits: [], terms: "" });
    expect(parseSlugs('["pro","pro","Bad Slug","x",5,"team"]')).toEqual(["pro", "team"]);
  });
  test("claim links stay inside the app and carry the offer", () => {
    expect(claimHref("/billing", "c1", "pro")).toBe("/billing?campaign=c1&plan=pro#plans");
    expect(claimHref("/billing?cycle=year", "c1", "pro")).toBe("/billing?cycle=year&campaign=c1&plan=pro#plans");
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "", "billing"]) {
      expect(claimHref(bad, "c1", "pro")).toBe("/billing?campaign=c1&plan=pro#plans");
    }
    expect(claimHref("/pricing", "c1", "pro")).toBe("/pricing?campaign=c1&plan=pro");
  });
  test("never on checkout, payment, auth or first-run screens", () => {
    for (const p of ["/billing", "/billing/receipt", "/checkout/x", "/settings/billing", "/login", "/signup", "/2fa", "/onboarding", "/welcome", "/auth/callback"]) expect(quietPath(p)).toBe(true);
    expect(quietPath("/settings", "#billing")).toBe(true);
    for (const p of ["/dashboard", "/calendar", "/content", "/settings", "/billingx"]) expect(quietPath(p)).toBe(false);
  });
  test("funnel", () => {
    expect(funnel({ impression: 200, click: 30, conversion: 3, dismiss: 150 })).toEqual({ impressions: 200, dismissals: 150, clicks: 30, conversions: 3, ctr: 15, cvr: 10 });
    expect(funnel({})).toEqual({ impressions: 0, dismissals: 0, clicks: 0, conversions: 0, ctr: 0, cvr: 0 });
  });
});

describe("popup motion (1122)", () => {
  const css = read("app/globals.css");
  const block = css.slice(css.indexOf("/* ---------- 1122"), css.indexOf("/* ---------- 1100: Liquid glass on every studio card"));
  const sheet = read("components/promo/PromoSheet.tsx");
  test("sheet 650ms, overlay 300ms, from translateY(100%) scale .97 opacity 0", () => {
    expect(block).toContain(".promo-sheet { animation: promo-rise 650ms var(--m-ease-out)");
    expect(block).toContain(".promo-overlay { background: rgba(10, 6, 4, 0.5); animation: promo-fade 300ms");
    expect(block).toMatch(/@keyframes promo-rise \{ from \{ transform: translateY\(100%\) scale\(\.97\); opacity: 0; \}/);
  });
  test("transform and opacity only; no blur, no bounce", () => {
    const frames = block.match(/@keyframes promo-[a-z]+ \{.*\}/g) ?? [];
    expect(frames.length).toBe(6);
    for (const f of frames) expect(f.replace(/transform|opacity|translateY|scale|from|to|none|keyframes|promo-[a-z]+/g, "")).not.toMatch(/[a-z]{3,}/);
    expect(block).not.toMatch(/backdrop-filter|filter:\s*blur|cubic-bezier\([^)]*-|cubic-bezier\(([^,]+,){3}\s*1\.[1-9]|bounce|elastic/);
    expect(block).not.toMatch(/:hover[^{]*\{[^}]*transform/); // hover never moves anything
  });
  test("the brief's stagger order", () => {
    const pairs = [...sheet.matchAll(/"--d" as string\]: "(\d+)ms", \["--t" as string\]: "(\d+)ms"/g)].map((m) => `${m[1]}/${m[2]}`);
    for (const want of ["180/350", "250/350", "350/500", "450/500", "550/400", "650/400", "750/400"]) expect(pairs).toContain(want);
  });
  test("reduced motion drops the rise, the stagger and the float", () => {
    const rm = block.slice(block.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(rm).toContain(".promo-sheet, .promo-in, .promo-bit > svg { animation: none; }");
    expect(rm).toContain("promo-fade 150ms linear");
  });
});

describe("tracking wiring (1122)", () => {
  test("the browser can only send impression, dismiss and click", () => {
    expect([...CLIENT_EVENTS]).toEqual(["impression", "dismiss", "click"]);
    const route = read("app/api/campaign/event/route.ts");
    expect(route).toContain("z.enum(CLIENT_EVENTS)");
    expect(route).not.toContain("conversion\"");
  });
  test("conversions come only from a completed payment", () => {
    const svc = read("lib/billing/service.ts");
    expect(svc).toContain("await convertCampaign(p)");
    expect(read("app/api/campaign/event/route.ts")).not.toContain("convertCampaign");
  });
  test("checkout validates the offer on the server", () => {
    expect(read("lib/billing/service.ts")).toContain("checkoutOffer(");
    expect(read("app/api/billing/checkout/route.ts")).toContain("campaign");
  });
  test("schema lives in both prisma files", () => {
    for (const f of ["prisma/schema.prisma", "prisma/schema.template.prisma"]) {
      const s = read(f);
      expect(s).toContain("model Campaign {");
      expect(s).toContain("model CampaignEvent {");
    }
  });
  test("popup mounts only for real users, once per entry", () => {
    expect(read("app/(studio)/layout.tsx")).toContain("{!user.actor && <PromoSheet />}");
    expect(read("components/promo/PromoSheet.tsx")).toContain("PROMO_SESSION_KEY");
  });
});

describe("review fixes (1122)", () => {
  const camp = read("lib/campaign.ts");
  const svc = read("lib/billing/service.ts");
  test("a founding member's struck price is their founding price, and the big number is the real saving", () => {
    expect(camp).toContain("originalMinor: Math.min(bp.tested.priceMinor, bp.foundingMinor)");
    const c = { kind: "pct", value: 50, currency: "INR" };
    expect(savingLabel(c, { originalMinor: 99900, listMinor: 99900, finalMinor: 49900, currency: "INR" })).toBe("50% OFF");
    expect(savingLabel(c, { originalMinor: 79900, listMinor: 99900, finalMinor: 49900, currency: "INR" })).toBe("37% OFF");
    expect(savingLabel({ kind: "fixed", value: 20000, currency: "INR" }, { originalMinor: 79900, listMinor: 99900, finalMinor: 59900, currency: "INR" })).toBe("₹200 OFF");
  });
  test("one redemption per person per offer; a monthly member can still take a yearly offer", () => {
    expect(camp).toContain("w.converted.has(c.id)");
    expect(camp).toContain("w.onPlans.has(`${plan.slug}:${want}`)");
  });
  test("a capped offer counts other people's open checkouts as held spots", () => {
    expect(camp).toContain("q.campaign.redemptions + holding >= q.campaign.maxRedemptions");
    expect(camp).toContain('`"campaign":{"id":${JSON.stringify(id)}`');
    // the tag must match what priceMeta really writes
    expect(svc).toContain("campaign: { id: offer.id, ...(offer.until");
  });
  test("sample payments convert nothing; late or over-limit payments alert the admin", () => {
    expect(camp).toContain("if (!id || p.sample) return;");
    expect(camp).toContain('"after it ended" : "past its limit"');
    expect(svc).toContain("until: offer.campaign.endsAt.toISOString()");
  });
  test("refunds give the conversion and the spot back, both paths", () => {
    expect(svc.match(/releaseCampaign\(p\.id\)/g)?.length).toBe(2);
    expect(camp).toContain("redemptions: { gt: 0 } }, data: { redemptions: { decrement: 1 } }");
  });
  test("one event per person, offer, kind and day is enforced by the database", () => {
    for (const f of ["prisma/schema.prisma", "prisma/schema.template.prisma"]) expect(read(f)).toContain("@@unique([campaignId, userId, kind, day])");
    expect(camp).toContain('code === "P2002") return false');
    expect(read("components/promo/PromoSheet.tsx")).toContain("if (!offer || claimed.current) return;");
    // conversions are one row per payment, so the unique index never drops a second paid offer
    expect(camp).toContain("day: `${today(now)}#${p.id}`");
    expect(read("lib/billing/service.ts")).toContain('if (refunded || kind === "chargeback") await releaseCampaign(p.id);')
    expect(read("app/(studio)/billing/page.tsx")).toContain("offerLabel: savingLabel(claimed, m)");
  });
  test("admin save and toggle of an unknown offer are a 404, not a 500", () => {
    expect(read("app/api/admin/campaigns/route.ts").match(/"That offer is gone\."/g)?.length).toBe(3);
  });
});
