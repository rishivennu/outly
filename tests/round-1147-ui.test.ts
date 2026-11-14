/**
 * 1147 subscriber-facing pricing: first-time and returning labels, the trial card, the monthly allowance meter,
 * the checkout summary before payment, the verification and review states, and the marketing intro price.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { budgetCopy, checkoutSummary, daysLeft, introThen, offerLine, tierLabel, trialCopy, type QuoteView } from "@/components/billing/offer-core";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const view = src("components/billing/BillingView.tsx");
const cards = src("components/billing/OfferCards.tsx");
const core = src("components/billing/offer-core.ts");
const page = src("app/(studio)/billing/page.tsx");
const pricing = src("components/marketing/Pricing.tsx");
const pricingCards = src("components/marketing/PricingCards.tsx");
const parts = src("components/billing/BillingParts.tsx");

const q = (o: Partial<QuoteView> = {}): QuoteView => ({ tier: "intro", reason: "first_time", priceMinor: 79900, currency: "INR", interval: "month", introMinor: 79900, standardMinor: 97900, ...o });
const NOW = new Date("2026-11-14T10:00:00Z");

describe("offer labels", () => {
  test("first-time offer names the price and the price after a lapse, in one line", () => {
    const l = offerLine(q(), 7)!;
    expect(l.badge).toBe("First-time subscriber offer");
    expect(l.text).toContain("799");
    expect(l.text).toContain("979");
    expect(l.text).toContain("more than 7 days");
    expect(l.text.split(". ").length).toBeLessThanOrEqual(2);
  });

  test("returning price has a short reason; risk and verification stay neutral", () => {
    expect(offerLine(q({ tier: "standard", reason: "returning", priceMinor: 97900 }), 7)!.badge).toBe("Returning subscriber price");
    expect(offerLine(q({ tier: "standard", reason: "returning" }), 7)!.text).toContain("subscribed before");
    const denied = offerLine(q({ tier: "standard", reason: "risk_denied" }), 7)!.text;
    expect(denied).toContain("ask for a review");
    expect(denied.toLowerCase()).not.toContain("fraud");
    expect(offerLine(q({ tier: "standard", reason: "needs_verification" }), 7)!.text).toContain("WhatsApp");
  });

  test("nothing new is said while the policy is off, or for founding and legacy prices", () => {
    for (const reason of ["policy_off", "founding", "legacy"] as const) expect(offerLine(q({ reason }), 7)).toBeNull();
    expect(offerLine(null, 7)).toBeNull();
  });

  test("tier words", () => {
    expect(tierLabel("intro")).toBe("First-time subscriber offer");
    expect(tierLabel("standard")).toBe("Returning subscriber price");
    expect(tierLabel("legacy")).toBeNull();
    expect(tierLabel(null)).toBeNull();
  });
});

describe("checkout summary before payment", () => {
  test("exact amount, tier and renewal price", () => {
    const s = checkoutSummary(q(), "Creator", 7);
    expect(s.amount).toContain("799");
    expect(s.amount).toContain("1 month");
    expect(s.tier).toBe("First-time subscriber offer");
    expect(s.renewal).toContain("799");
    expect(s.note).toContain("979");
  });

  test("a returning subscriber renews at the standard price, yearly says 1 year", () => {
    const s = checkoutSummary(q({ tier: "standard", reason: "returning", priceMinor: 979000, introMinor: 799000, standardMinor: 979000, interval: "year" }), "Creator", 7);
    expect(s.amount).toContain("1 year");
    expect(s.renewal).toContain("/yr");
    expect(s.renewal).toContain("9,790");
    expect(s.note).toBeNull();
  });

  test("BillingView opens the summary first whenever a quote exists, then pays", () => {
    expect(view).toContain("if (!confirmed && (y ? y.quote : p.quote)) return setSummary(p);");
    expect(view).toContain('confirmLabel="Continue to payment"');
    expect(view).toContain("choose(summary, true)");
    expect(view).toContain("<CheckoutSummaryView");
  });
});

describe("trial card", () => {
  const t = { status: "none" as const, planName: "Creator", days: 7, endsAt: null, block: null };
  test("start, then days left with cancel", () => {
    expect(trialCopy(t)!.action).toBe("start");
    expect(trialCopy(t)!.title).toBe("Try Creator free for 7 days");
    const a = trialCopy({ ...t, status: "active", endsAt: "2026-11-17T09:00:00Z" }, NOW)!;
    expect(a.action).toBe("cancel");
    expect(a.title).toBe("3 days left in your Creator trial");
    expect(trialCopy({ ...t, status: "active", endsAt: "2026-11-14T09:00:00Z" }, NOW)!.title).toContain("ends today");
  });

  test("blocked, used or disabled trials", () => {
    expect(trialCopy({ ...t, block: "needs_verification" })!.action).toBe("verify");
    expect(trialCopy({ ...t, block: "risk_denied" })!.action).toBe("review");
    expect(trialCopy({ ...t, block: "used" })).toBeNull();
    expect(trialCopy({ ...t, block: "already_paid" })).toBeNull();
    expect(trialCopy({ ...t, days: 0 })).toBeNull();
    expect(trialCopy({ ...t, status: "expired" })).toBeNull();
  });

  test("days left counts part days and never goes negative", () => {
    expect(daysLeft("2026-11-14T10:00:01Z", NOW)).toBe(1);
    expect(daysLeft("2026-11-13T10:00:00Z", NOW)).toBe(0);
  });

  test("buttons post to the trial route with a source", () => {
    expect(cards).toContain('api("/api/billing/trial", { method: "POST", json: { action, source } })');
    expect(cards).toContain("Start ${trial.days}-day trial");
    expect(cards).toContain('"Cancel trial"');
  });
});

describe("monthly allowance meter", () => {
  const b = { mode: "enforce" as const, budgetMinor: 30000, spentMinor: 0, pct: 20, blocked: false, resetsAt: "2026-12-01T00:00:00Z" };
  test("plain copy at each level, percent only", () => {
    expect(budgetCopy(b)!.tone).toBe("ok");
    const w = budgetCopy({ ...b, pct: 85 })!;
    expect(w.tone).toBe("warn");
    expect(w.body).toContain("Scheduling, publishing");
    const x = budgetCopy({ ...b, pct: 100, blocked: true })!;
    expect(x.tone).toBe("bad");
    expect(x.body).toContain("paused until");
    expect(x.body).toContain("top-up");
    for (const c of [w, x]) expect(c.body).not.toMatch(/₹|\$|paise/);
  });

  test("alert mode never claims a pause; off or no budget shows nothing", () => {
    expect(budgetCopy({ ...b, mode: "alert", pct: 100, blocked: true })!.body).not.toContain("paused");
    expect(budgetCopy({ ...b, mode: "off" })).toBeNull();
    expect(budgetCopy({ ...b, budgetMinor: 0 })).toBeNull();
  });
});

describe("verification and review", () => {
  test("next steps: verify the WhatsApp number, or ask for a review", () => {
    expect(cards).toContain("Verify WhatsApp number");
    expect(cards).toContain('api("/api/billing/review"');
    expect(cards).toContain('id="offer-review"');
    expect(core).toContain('VERIFY_HREF = "/settings#ph-h"');
  });
});

describe("billing page wiring", () => {
  test("the server's own label and detail win when the quote carries them", () => {
    expect(offerLine(q({ label: "Returning subscriber price", detail: "Your earlier plan ended more than 7 days ago.", tier: "standard", reason: "returning" }), 7)).toEqual({ badge: "Returning subscriber price", text: "Your earlier plan ended more than 7 days ago." });
    expect(checkoutSummary(q({ renewMinor: 79900 }), "Creator", 7).renewal).toContain("799");
  });

  test("policy off changes nothing; a claimed campaign keeps its own price", () => {
    expect(page).toContain("if (policy.enabled) {");
    expect(page).toContain("plans={plansOut}");
    expect(page).toContain("claimedHere(pp) ? null");
    expect(page).toContain('q.reason !== "policy_off"');
    // Only first-time and returning quotes re-price a card; founding and legacy keep the figures already shown.
    expect(page).toContain('q.tier === "intro" || q.tier === "standard"');
  });

  test("quotes come from the server's single source of truth", () => {
    expect(page).toContain("@/lib/subscriptions");
    expect(page).toContain("quote({");
    expect(page).toContain("budgetState(");
    expect(page).toContain("trialState(");
  });
});

describe("marketing pricing", () => {
  test("first-time price plus the then price, server-rendered from the policy", () => {
    expect(pricing).not.toContain('"use client"');
    expect(pricing).toContain("getPolicy()");
    expect(pricing).toContain("introThen(");
    expect(pricingCards).toContain("First-time subscriber offer.");
    expect(introThen(97900, "INR", "month", 7)).toContain("979/mo only if your plan lapses for more than 7 days");
  });
});

describe("copy rules", () => {
  test("no em dashes or tiny text in the new UI", () => {
    for (const s of [cards, core]) {
      expect(s).not.toContain("\u2014");
      expect(s).not.toMatch(/text-\[(10|11)(\.5)?px\]/);
    }
  });

  test("the empty billing history wraps on narrow screens", () => {
    expect(parts).toContain('<p className="min-w-0 break-words text-sm text-muted-foreground">No payments yet.');
  });
});
