/** Phase 2 onboarding UI: house rules and the wiring that keeps it one system (checklist, flow, Help, page tips). */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const FILES = [
  "components/onboarding/OnboardingFlow.tsx",
  "components/onboarding/SetupGuide.tsx",
  "components/onboarding/onboarding-client.ts",
  "components/onboarding/steps/ConnectStep.tsx",
  "components/onboarding/steps/ProfileStep.tsx",
  "components/onboarding/steps/ExploreStep.tsx",
  "components/onboarding/SetupChecklist.tsx",
  "lib/onboarding-core.ts",
  "lib/onboarding.ts",
  "app/api/me/onboarding/route.ts",
];

describe("house rules", () => {
  for (const f of FILES)
    test(`${f}: no em or en dashes, no emoji, no transition-all, no bare hover`, () => {
      const s = src(f);
      expect(s).not.toMatch(/[\u2013\u2014]/);
      expect(s).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      expect(s).not.toContain("transition-all");
      expect(s).not.toMatch(/(?<![:\]])hover:bg-foreground/);
    });
  test("the flow respects reduced motion and has 44px progress targets", () => {
    const s = src("components/onboarding/OnboardingFlow.tsx");
    expect(s).toContain("useReducedMotion()");
    expect(s).toContain("T.fade");
    expect(s).toContain("h-11 w-full");
    expect(s).toContain('aria-current={n === i ? "step" : undefined}');
  });
});

describe("one system", () => {
  test("Home mounts the flow before the checklist and the greetings, on both dashboards", () => {
    const s = src("app/(studio)/home/page.tsx");
    expect(s.match(/<OnboardingFlow initial=\{onboarding\} auto \/>/g)?.length).toBe(2);
    expect(s.match(/<SetupChecklist onboarding=\{onboarding\} \/>/g)?.length).toBe(2);
    expect(s.indexOf("<OnboardingFlow")).toBeLessThan(s.indexOf("<FoundingWelcome"));
  });
  test("the checklist reads the saved steps, keeps the device rows, and hiding it dismisses on the server", () => {
    const s = src("components/onboarding/SetupChecklist.tsx");
    expect(s).toContain('aria-label="Hide the setup checklist" className="h-11 w-11 shrink-0"');
    expect(s).toContain('saveOnboarding({ action: "dismiss" })');
    expect(s).toContain("openOnboarding(");
    expect(s).not.toContain("startTour()"); // the first-run walk-through is the flow's now
  });
  test("the flow waits its turn and hands over to the greetings like the tour did", () => {
    const s = src("components/onboarding/OnboardingFlow.tsx");
    expect(s).toContain("afterPrivacy(user.id");
    expect(s).toContain("readConsent()");
    expect(s).toContain('"data-welcome"');
    expect(s).toContain('new Event("outly:tour-closed")');
    expect(s).toContain('new Event("outly:guide")');
  });
  test("explore steps deep link into the pages and their own tips", () => {
    const s = src("components/onboarding/steps/ExploreStep.tsx");
    for (const h of ["/create?tips=1", "/calendar?tips=1", "/analytics?tips=1"]) expect(s).toContain(h);
    expect(src("components/onboarding/PageGuide.tsx")).toContain('q.get("tips") === "1"');
  });
  test("Help and Support lists the steps and can reopen or restart them", () => {
    expect(src("app/(studio)/support/page.tsx")).toContain("onboardingFor(user)");
    expect(src("components/support/MyRequests.tsx")).toContain("<SetupGuide");
    const g = src("components/onboarding/SetupGuide.tsx");
    expect(g).toContain("openOnboarding(s.id)");
    expect(g).toContain('saveOnboarding({ action: "reset" })');
  });
  test("connect only offers what the server can really connect", () => {
    const s = src("components/onboarding/steps/ConnectStep.tsx");
    expect(s).toContain("Coming later");
    expect(s).toContain("/api/accounts/${o.platform}/connect");
    expect(src("lib/onboarding.ts")).toContain('hasCredentials(p) ? "oauth" : canConnectWithToken(p) ? "token" : practiceAllowed() ? "practice" : "later"');
  });
  test("the profile step reuses the profile endpoints and editors", () => {
    const s = src("components/onboarding/steps/ProfileStep.tsx");
    expect(s).toContain('"/api/settings/profile"');
    expect(s).toContain("<ImageCropper");
    expect(s).toContain("<SocialLinksSheet");
  });
});
