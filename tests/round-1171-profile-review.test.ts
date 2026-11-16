/**
 * 1171: the Profile Review moved out of the bottom of Analytics into its own page at /profile-review, with a
 * sidebar entry under Analytics. Same review, same calculations, same requests; the Analytics page no longer
 * renders it and no longer warms its request.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MAIN, ANIM, isActive, pageTitle } from "../components/shell/nav-items";
import { appTitle } from "../lib/app-mode";
import { STUDIO_RE } from "../lib/pwa-core";
import { ANIMATED } from "../components/icons/animated/index";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const review = src("components/analytics/ProfileReview.tsx");
const view = src("components/analytics/AnalyticsView.tsx");
const page = src("app/(studio)/profile-review/page.tsx");
const warm = src("lib/client/warm.ts");
const hover = src("components/shell/HoverLink.tsx");
const middleware = src("middleware.ts");

describe("sidebar entry", () => {
  test("Profile Review sits directly below Analytics and above Inbox", () => {
    const hrefs = MAIN.map((m) => m.href);
    const a = hrefs.indexOf("/analytics");
    expect(a).toBeGreaterThan(-1);
    expect(hrefs[a + 1]).toBe("/profile-review");
    expect(hrefs[a + 2]).toBe("/inbox");
    expect(MAIN[a + 1].label).toBe("Profile Review");
  });

  test("Analytics is unchanged", () => {
    expect(MAIN.find((m) => m.href === "/analytics")?.label).toBe("Analytics");
  });

  test("it has an animated rail icon, a phone title and an app title", () => {
    expect(ANIM["/profile-review"]).toBe("review");
    expect(ANIMATED.review).toBeDefined();
    expect(pageTitle("/profile-review")).toBe("Profile Review");
    expect(appTitle("/profile-review").title).toBe("Profile Review");
  });

  test("active highlighting is exact: /profile-review never lights Analytics and the reverse", () => {
    expect(isActive("/profile-review", "/profile-review")).toBe(true);
    expect(isActive("/profile-review", "/analytics")).toBe(false);
    expect(isActive("/analytics", "/profile-review")).toBe(false);
  });
});

describe("route", () => {
  test("needs a session, is never indexed, and is part of the studio for the PWA", () => {
    expect(middleware).toContain('"/analytics", "/profile-review", "/inbox"');
    expect(STUDIO_RE.test("/profile-review")).toBe(true);
    expect(STUDIO_RE.test("/profile-reviewer")).toBe(false);
  });

  test("the page is dynamic with a title and renders the one review component", () => {
    expect(page).toContain('export const dynamic = "force-dynamic"');
    expect(page).toContain('title: "Profile Review"');
    expect(page).toContain("<ProfileReview />");
  });
});

describe("the review itself", () => {
  test("everything the section had is still there, from the same requests", () => {
    for (const s of ["/api/analytics/review", "/api/analytics/live", "Analyse with Pip AI", "What the score is made of", "By platform", "Do this next", "Working for you", "Holding you back", "Audience and timing", "How this is worked out", "ScoreRing", "LiveViews", "out of 100"]) expect(review).toContain(s);
    expect(review).not.toContain("Gemini");
    expect(review).not.toContain("compactMode");
  });

  test("the page heading and description are the ones asked for, with the scope said plainly", () => {
    expect(review).toMatch(/<h1 id="pr-title"[^>]*>Profile Review<\/h1>/);
    expect(review).toContain("Understand what&apos;s working, what&apos;s holding you back, and what to improve next.");
    expect(review).toContain('data-testid="review-scope"');
    expect(review).toContain("Last 30 days");
    expect(review).toMatch(/never pretends to filter what the\s*\*?\s*server has not filtered/);
  });

  test("the method is written out, not implied", () => {
    expect(review).toContain("never added together across platforms");
    expect(review).toContain("left out of the average rather than counted as zero");
  });
});

describe("analytics cleanup", () => {
  test("Analytics no longer renders or imports the review, and leaves no placeholder", () => {
    expect(view).not.toContain("ProfileReview");
    expect(view).not.toContain("pr-title");
    expect(view).toContain("<LiveStrip connected={connected} />");
  });

  test("the review request is warmed for Profile Review, not for Analytics, so no page asks twice", () => {
    expect(warm).toContain("export function warmReview(");
    const analytics = warm.slice(warm.indexOf("export function warmAnalytics("));
    expect(analytics).not.toContain("/api/analytics/review");
    expect(hover).toContain('if (href === "/profile-review") return warmReview(router);');
  });
});
