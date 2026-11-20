import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SETUP_COOKIE_DAYS, SETUP_HIDDEN_COOKIE, deviceHint, setupHiddenFor, setupTag, withSetupHidden } from "../lib/onboarding-core";

// Perf workstream A (startup): CLS from the setup checklist and the entry popups, and the welcome stagger.
const root = join(import.meta.dir, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

describe("A6 the server knows whether the setup card shows", () => {
  test("hidden cookie holds a short tag per account, never the id", () => {
    expect(SETUP_HIDDEN_COOKIE).toBe("outly-setup-hidden");
    expect(SETUP_COOKIE_DAYS).toBe(180);
    const tag = setupTag("user_abc");
    expect(tag).toMatch(/^[a-z0-9]{1,8}$/);
    expect(tag).not.toContain("user_abc");
    const c = withSetupHidden(null, "user_abc");
    expect(setupHiddenFor(c, "user_abc")).toBe(true);
    expect(setupHiddenFor(c, "user_xyz")).toBe(false);
    expect(setupHiddenFor(undefined, "user_abc")).toBe(false);
    const both = withSetupHidden(c, "user_xyz");
    expect(setupHiddenFor(both, "user_abc") && setupHiddenFor(both, "user_xyz")).toBe(true);
    expect(withSetupHidden(both, "user_xyz")).toBe(both);
    let many: string | null = null;
    for (let i = 0; i < 20; i++) many = withSetupHidden(many, `u${i}`);
    expect(many!.split(".").length).toBeLessThanOrEqual(8);
    expect(setupHiddenFor(many, "u19")).toBe(true);
  });
  test("device hint", () => {
    expect(deviceHint("1")).toBe(true);
    expect(deviceHint("0")).toBe(false);
    expect(deviceHint(undefined)).toBe(null);
    expect(deviceHint("x")).toBe(null);
  });
  test("checklist renders on the server, writes both stores on dismiss, reserves the device row", () => {
    const s = src("components/onboarding/SetupChecklist.tsx");
    expect(s).not.toMatch(/useState\(false\)[^\n]*ready|!ready/);
    expect(s).toContain("localStorage.setItem(hiddenKey(user.id), \"1\");");
    expect(s).toContain("writeCookie(SETUP_HIDDEN_COOKIE, withSetupHidden(readCookie(SETUP_HIDDEN_COOKIE), user.id));");
    expect(s).toContain("Path=/; Max-Age=${SETUP_COOKIE_DAYS * 86_400}; SameSite=Lax");
    expect(s).toContain('data-setup-reserve=""');
    expect(s).toContain("min-h-[124px]");
    const h = src("app/(studio)/home/page.tsx");
    expect(h).toContain("setupHiddenFor(jar.get(SETUP_HIDDEN_COOKIE)?.value, user.id)");
    expect(h).toContain("hidden={setup.hidden} deviceOpen={setup.deviceOpen}");
  });
});

describe("A7 entry popups queue up and never take layout space", () => {
  test("cookie choice -> privacy -> tour -> welcome offer -> promo -> what's new", () => {
    expect(src("components/shared/CookieConsent.tsx")).toContain("if (!c) off = afterWelcome(() => setShow(true));");
    const p = src("components/shared/PrivacyNotice.tsx");
    expect(p).toContain("if (document.hidden || !readConsent()) return;");
    expect(p).toContain("if (welcomePending()) return;");
    expect(src("components/onboarding/OnboardingFlow.tsx")).toContain("unPrivacy = afterPrivacy(user.id, () =>");
    for (const f of ["components/onboarding/WelcomeSubscribe.tsx", "components/founding/FoundingWelcome.tsx"]) {
      const w = src(f);
      expect(w).toContain("if (localStorage.getItem(tourKey(user.id))) unPrivacy = afterPrivacy(user.id, show);");
      expect(w).toContain('window.addEventListener("outly:tour-closed", onClosed, { once: true });');
    }
    const promo = src("components/promo/PromoSheet.tsx");
    expect(promo).toContain("if (!localStorage.getItem(tourKey(owner))) return;");
    expect(promo).toContain("const undo = afterWelcome(");
    expect(promo).toContain("if (document.querySelector('[aria-labelledby=\"cc-title\"]')) return;");
    expect(promo).toContain('document.documentElement.dataset.onboarding = "promo";');
    const wn = src("components/shell/WhatsNew.tsx");
    expect(wn).toContain("toured = !!localStorage.getItem(tourKey(owner));");
    expect(wn).toContain("if (document.querySelector('[aria-labelledby=\"cc-title\"]')) return;");
    expect(wn).toContain("document.documentElement.dataset.onboarding");
    expect(src("components/shell/InstallPrompt.tsx")).toContain("!!document.documentElement.dataset.onboarding ||");
  });
  test("every one of them is position: fixed", () => {
    expect(src("components/shared/CookieConsent.tsx")).toMatch(/aria-labelledby="cc-title"[^>]*className=\{cn\("[^"]*\bfixed\b/);
    for (const [f, re] of [
      ["components/shared/PrivacyNotice.tsx", /className="fixed inset-0 z-\[81\]/],
      ["components/promo/PromoSheet.tsx", /promo-sheet fixed/],
      ["components/shell/WhatsNew.tsx", /className="fixed inset-0 z-\[81\]/],
      ["components/pwa/InstallGuide.tsx", /install-sheet fixed/],
      ["components/founding/FoundingWelcome.tsx", /className="fixed inset-0/],
    ] as const)
      expect(src(f)).toMatch(re);
  });
});

describe("A8 welcome text is readable at once", () => {
  const css = src("app/globals.css");
  const block = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference) {\r\n  /* perf A8"), css.indexOf("wa-float"));
  test("nothing in the entrance starts later than .25s, the title has no delay and starts half visible", () => {
    expect(block).toContain(".pw-b { animation: pw-lift .45s var(--pw-ease) both; }");
    expect(css).toContain("@keyframes pw-lift { from { opacity: .5; transform: translateY(10px); } }");
    const delays = [...block.matchAll(/ (\.\d+)s both/g)].map((m) => Number(m[1]));
    expect(Math.max(0, ...delays)).toBeLessThanOrEqual(0.25);
    const m = /calc\((\d+)ms \+ var\(--i, 0\) \* (\d+)ms\)/.exec(block)!;
    expect(Number(m[1]) + 3 * Number(m[2])).toBeLessThanOrEqual(250); // four buttons, --i 0..3
  });
  test("watchdog and exit unchanged", () => {
    const w = src("components/shell/PwaWelcome.tsx") + src("lib/pwa-welcome.ts");
    expect(w).toContain("export const WELCOME_EXIT_MS = 300;");
    expect(w).toMatch(/WELCOME_WATCHDOG_MS = 10_000/);
  });
});
