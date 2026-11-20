/** R1282 benefits: source pins for the public offer/portal surface, admin routes and the attribution hooks. */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PARTNER_CODE_RE, attributionAllowed, codeBase, isPartnerCode, makePartnerCode, parsePartnerCookie, partnerCookie } from "../lib/partners/attribution-core";
import { DELIVERABLE_APPROVALS, durationLabel, offerTermsOf } from "../lib/partners/offer-core";

const root = join(import.meta.dir, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : f === "route.ts" ? [join(dir, f)] : []));

describe("public surface", () => {
  test("offer, portal and visit endpoints are rate limited", () => {
    expect(src("app/api/partners/offer/[token]/route.ts")).toMatch(/rateLimit\(`partner-offer:/);
    expect(src("app/api/partners/portal/[token]/deliverables/route.ts")).toMatch(/rateLimit\(`partner-portal:/);
    expect(src("app/api/partners/visit/route.ts")).toMatch(/rateLimit\(`partner-visit:/);
  });
  test("offer and portal pages are noindex, no-referrer and dynamic", () => {
    for (const p of ["app/(marketing)/partners/offer/[token]/page.tsx", "app/(marketing)/partners/portal/[token]/page.tsx"]) {
      const s = src(p);
      expect(s).toContain("robots: { index: false, follow: false, nocache: true }");
      expect(s).toContain('referrer: "no-referrer"');
      expect(s).toContain('dynamic = "force-dynamic"');
    }
  });
  test("visit route counts only with consent", () => {
    const s = src("app/api/partners/visit/route.ts");
    expect(s).toContain("attributionAllowed");
    expect(s).toContain("CONSENT_KEY");
  });
  test("the creator portal never exposes the admin note", () => {
    const s = src("lib/partners/deliverables.ts");
    const pub = s.slice(s.indexOf("export const publicDeliverable"), s.indexOf("export type PublicDeliverable"));
    expect(pub).not.toContain("adminNote");
  });
});

describe("admin routes", () => {
  const files = [
    ...walk(join(root, "app/api/admin/partners/[id]/offers")),
    ...walk(join(root, "app/api/admin/partners/[id]/deliverables")),
    join(root, "app/api/admin/partners/[id]/code/route.ts"),
  ];
  test("every benefits admin route is gated on the partners section", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      const handlers = s.match(/export const (GET|POST|PATCH|DELETE)\b/g) ?? [];
      expect(handlers.length).toBeGreaterThan(0);
      expect((s.match(/adminRoute<[^>]*>\("partners"/g) ?? []).length).toBe(handlers.length);
    }
  });
  test("offers only grant through changeStatus and grantBenefit", () => {
    const s = src("lib/partners/offers.ts");
    expect(s).toContain('from "./admin"');
    expect(s).not.toMatch(/partnerApplication\.update\(\{[^}]*status:/);
    expect(src("lib/partners/benefits.ts")).toContain('"NOT_ACCEPTED"');
  });
});

describe("hooks", () => {
  test("signup and payment record partner attribution without throwing", () => {
    expect(src("lib/referral.ts")).toMatch(/import\("\.\/partners\/attribution"\)\.then\(\(m\) => m\.attachPartnerSignup\(newUserId\)\)\.catch/);
    expect(src("lib/billing/service.ts")).toMatch(/import\("\.\.\/partners\/attribution"\)\.then\(\(m\) => m\.recordPaid\(p\.userId, p\.id\)\)\.catch/);
    expect(src("components/shared/RootClient.tsx")).toContain("PartnerRefBeacon");
  });
  test("client components import only client-safe partner modules", () => {
    for (const p of ["components/partners/OfferView.tsx", "components/partners/PortalView.tsx", "components/admin/partners/OfferEditor.tsx", "components/admin/partners/DeliverablesPanel.tsx", "components/partners/PartnerRefBeacon.tsx"]) {
      const s = src(p);
      for (const m of s.matchAll(/^import (type )?.*from "@\/lib\/partners\/(offers|benefits|deliverables|attribution)";$/gm)) expect(m[1]).toBe("type ");
    }
  });
});

describe("attribution core", () => {
  test("codes", () => {
    expect(isPartnerCode("rishi42")).toBe(true);
    expect(isPartnerCode("ab")).toBe(false);
    expect(isPartnerCode("Rishi42")).toBe(false);
    const base = codeBase("@Rishi.Vennu_", "fallback");
    expect(base).toMatch(/^[a-z0-9]+$/);
    let i = 0;
    const code = makePartnerCode(base, () => [4, 2][i++ % 2]);
    expect(code.endsWith("42")).toBe(true);
    expect(PARTNER_CODE_RE.test(code)).toBe(true);
    expect(makePartnerCode("x".repeat(40), () => 1).length).toBe(20);
  });
  test("cookie round trip and rejects tampering", () => {
    const v = "123e4567-e89b-12d3-a456-426614174000";
    expect(parsePartnerCookie(partnerCookie("rishi42", v))).toEqual({ code: "rishi42", visitorKey: v });
    expect(parsePartnerCookie(`rishi42.${v}.x`)).toBeNull();
    expect(parsePartnerCookie(`RISHI.${v}`)).toBeNull();
    expect(parsePartnerCookie("rishi42.nope")).toBeNull();
    expect(parsePartnerCookie(null)).toBeNull();
  });
  test("consent: analytics or marketing only", () => {
    expect(attributionAllowed(null)).toBe(false);
    expect(attributionAllowed("n")).toBe(false);
    expect(attributionAllowed("a")).toBe(true);
    expect(attributionAllowed("nm")).toBe(true);
  });
});

describe("offer core", () => {
  test("terms snapshot shape", () => {
    const t = offerTermsOf({ type: "both", amountMinor: 1500000, currency: "INR", paymentTerms: "Within 15 days", planSlug: "studio", subscriptionDays: 30, startsAt: null, endsAt: null, deliverables: 2, platforms: ["instagram"], format: "Reel", deadlines: "", disclosure: true, usageRights: "", conditions: "" } as never, "Studio");
    expect(t.amount).toContain("15,000");
    expect(t.planName).toBe("Studio");
    expect(t.platformLabels).toEqual(["Instagram"]);
    expect(durationLabel(30)).toBe("1 month");
    expect(offerTermsOf({ ...t, planSlug: "", type: "paid" } as never).subscriptionDays).toBe(0);
    expect(DELIVERABLE_APPROVALS).toContain("none");
  });
});
