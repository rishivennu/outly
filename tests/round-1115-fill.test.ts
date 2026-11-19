/** 1115: the app fills the screen like a native app: a docked solid tab bar, one flat page fill on phones. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const css = src("app/globals.css");

describe("1115 app fill", () => {
  test("the tab bar is solid (1115) and, since 11-19, a floating pill clear of the home indicator", () => {
    const nav = src("components/shell/Nav.tsx");
    expect(nav).toContain('className="mtab web-only fixed inset-x-0 z-40 flex items-stretch lg:hidden"');
    const rule = css.slice(css.indexOf(".mtab {"), css.indexOf("}", css.indexOf(".mtab {")));
    expect(rule).toContain("border: 1px solid hsl(var(--mtab-line));");
    expect(rule).toContain("background: linear-gradient(180deg, hsl(var(--mtab-bg) / .72), hsl(var(--mtab-bg) / .62));");
    expect(rule).not.toContain("left:");
    expect(css).not.toContain("transform: translateY(calc(100% + 4px)); opacity: 0;");
  });
  test("inside the app on a phone the page is one flat fill; public pages keep their sky", () => {
    expect(css).toContain("body:not(:has(.sky-host))::before { display: none; }");
    expect(css).toContain("html:not(.dark) body:has(.sky-host)::before {");
  });
  test("nothing above the bar still uses the floating pill's offset", () => {
    for (const f of ["components/support/ChatWidget.tsx", "components/shared/DeviceHint.tsx", "components/shared/CookieConsent.tsx", "components/onboarding/Spotlight.tsx", "components/create/BulkPlanner.tsx", "components/create/PlatformDeck.tsx", "components/shared/Toast.tsx", "app/(studio)/layout.tsx"])
      expect(src(f)).not.toMatch(/max\(12px, ?env\(safe-area-inset-bottom\)\) ?\+ ?\d+px/);
    expect(css).not.toMatch(/max\(12px, env\(safe-area-inset-bottom\)\) \+ \d+px/);
  });
});
