/** 1104 (Round 3): one fluid page frame for every studio page instead of per-page widths. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const css = src("app/globals.css");

const PAGES = [
  "app/(studio)/home/page.tsx",
  "components/dashboard/PulseHome.tsx",
  "components/shared/HomeHero.tsx",
  "components/home/ProfileSwitcher.tsx",
  "components/onboarding/SetupChecklist.tsx",
  "components/analytics/AnalyticsView.tsx",
  "components/analytics/PlatformTabs.tsx",
  "components/analytics/PlatformDashboardView.tsx",
  "components/content/ContentLibrary.tsx",
  "components/calendar/CalendarView.tsx",
  "components/approvals/ApprovalsBoard.tsx",
  "components/settings/AccountsView.tsx",
  "components/settings/SettingsShell.tsx",
  "components/billing/BillingView.tsx",
  "components/support/HelpCenter.tsx",
  "components/create/BulkPlanner.tsx",
  "components/shared/RouteSkeleton.tsx",
  "components/shared/Skeleton.tsx",
];

describe("1104 the frame", () => {
  test("one max width and a clamp() gutter, in the components layer so utilities can narrow it", () => {
    expect(css).toContain(":root { --frame-max: 1680px; --frame-gutter: clamp(20px, calc(2vw + 14px), 56px); }");
    const layer = css.slice(css.lastIndexOf("@layer components {", css.indexOf(".page-frame {")));
    expect(layer).toMatch(/^@layer components \{\s*(\/\*[^]*?\*\/\s*)?\.page-frame \{ width: 100%; max-width: var\(--frame-max\); margin-inline: auto; padding-inline: var\(--frame-gutter\); \}/);
    expect(css).toContain(".frame-bleed { margin-inline: calc(var(--frame-gutter) * -1); padding-inline: var(--frame-gutter); }");
  });
  test("every studio page uses it and none keeps its own width or fixed gutters", () => {
    for (const p of PAGES) {
      const s = src(p);
      expect(s, p).toContain("page-frame");
      expect(s, p).not.toMatch(/max-w-\[1320px\]|\bsm:px-10\b|\bsm:-mx-10\b/);
    }
  });
  test("home rows no longer stop at 5xl/6xl", () => {
    for (const p of ["app/(studio)/home/page.tsx", "components/dashboard/PulseHome.tsx", "components/shared/HomeHero.tsx", "components/home/ProfileSwitcher.tsx", "components/onboarding/SetupChecklist.tsx"]) {
      expect(src(p), p).not.toMatch(/max-w-(5xl|6xl)/);
    }
  });
  test("billing fills the frame: no inner 5xl/6xl caps left to make ragged right edges", () => {
    for (const p of ["components/billing/BillingView.tsx", "components/billing/PlanExtras.tsx", "components/billing/GuaranteeCard.tsx", "components/billing/BetaRedeem.tsx", "components/founding/FoundingCard.tsx"]) {
      expect(src(p), p).not.toMatch(/max-w-(5xl|6xl)/);
    }
  });
  test("reading-width forms keep their width but share the gutter", () => {
    const bulk = src("components/create/BulkPlanner.tsx");
    expect(bulk).toContain('"page-frame max-w-4xl pb-28 pt-8 lg:pt-14"');
    expect(bulk).toContain('"page-frame max-w-2xl pb-20 pt-10 lg:pt-16"');
    expect(src("components/settings/SettingsShell.tsx")).toContain("grid max-w-6xl gap-6");
  });
  test("the Content header bleeds to the frame edge with the shared gutter", () => {
    expect(src("components/content/ContentLibrary.tsx")).toContain('"frame-bleed relative -mt-8 overflow-hidden pt-10 text-center lg:-mt-14 lg:pt-16"');
  });
  test("loaders match the page they stand in for, so nothing jumps when it lands", () => {
    expect(src("components/shared/RouteSkeleton.tsx")).toContain('frame = "page-frame pb-16 pt-8 lg:pt-14"');
    expect(src("app/(studio)/analytics/loading.tsx")).toContain('frame="page-frame pb-20"');
    expect(src("components/analytics/AnalyticsView.tsx")).toContain('const FRAME = "page-frame pb-20";');
    expect(src("app/(studio)/analytics/[platform]/loading.tsx")).toContain('frame="page-frame pb-16"');
    expect(src("components/analytics/PlatformDashboardView.tsx")).toContain('"page-frame pb-16"');
    expect(src("app/(studio)/billing/loading.tsx")).toContain('frame="page-frame pb-16 pt-8 lg:pt-12"');
    expect(src("components/billing/BillingView.tsx")).toContain('"page-frame pb-16 pt-8 lg:pt-12"');
  });
  test("analytics tabs share the frame on Overview and every platform", () => {
    const tabs = src("components/analytics/PlatformTabs.tsx");
    expect(tabs).toContain('className="an-tabs page-frame pt-8 lg:pt-12"');
    expect(tabs).not.toContain('path === "/analytics" &&');
  });
});

import { NUMBER_TIMING, bezier, stepperOf } from "../lib/motion/numbers";

describe("1104 analytics numbers count visibly", () => {
  test("no curve front-loads the count: under a third of the way after the first tenth", () => {
    for (const [k, e] of Object.entries(NUMBER_TIMING)) {
      const f = bezier(e.ease);
      expect(f(0.1), k).toBeLessThan(0.33);
      expect(f(0.5), k).toBeLessThan(0.9);
      expect(f(0.9), k).toBeGreaterThan(0.95);
    }
  });
  test("a count from zero never shows 0.0K", () => {
    const k = stepperOf("compact", 95_000);
    expect(k(10)).toBe("0");
    expect(k(0)).toBe("0");
    expect(k(400)).toBe("0.4K");
    expect(stepperOf("compact", 2_400_000)(20_000)).toBe("0");
  });
  test("numbers in a rising KPI card wait for their card", () => {
    const a = src("components/shared/AnimatedNumber.tsx");
    expect(a).toContain('node.closest<HTMLElement>(".kpi-in")');
    expect(a).toContain('animationName === "kpi-rise"');
    expect(a).toContain("const lead = played.current ? 0 : cardLead(node);");
    expect(a).toContain("clearTimeout(wait);");
  });
});

describe("1104 review", () => {
  test("page-frame never shares a class string with its own gutter or centring", () => {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = `${d}/${n}`; return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : []; });
    for (const f of [...walk("app"), ...walk("components")]) {
      for (const m of src(f).matchAll(/"([^"]*\bpage-frame\b[^"]*)"/g)) {
        const cls = m[1].split(/\s+/);
        expect(cls.filter((c) => /^(sm:|md:|lg:)?(px-(?!0$)|mx-auto$|-?mx-)/.test(c)), `${f}: ${m[1]}`).toEqual([]);
      }
    }
  });
  test("loaders start where their page starts", () => {
    expect(src("app/(studio)/home/loading.tsx")).toContain('frame="page-frame pb-16 pt-4"');
    expect(src("components/shared/RouteSkeleton.tsx")).toContain('"frame-bleed -mt-8 flex flex-col items-center pt-10 lg:-mt-14 lg:pt-16');
  });
  test("the bar above every page and the publish screen share the frame", () => {
    expect(src("components/shell/WorkspaceBar.tsx")).toContain("px-[var(--frame-gutter)] py-2");
    expect(src("components/shell/WorkspaceBar.tsx")).not.toContain("sm:px-10");
    expect(src("components/create/CreateWorkspace.tsx")).toContain('<div className="page-frame relative px-0">');
  });
});

describe("1104 live count hydration", () => {
  test("first render never reads the shared cache", () => {
    const s = src("components/shared/LiveCount.tsx");
    expect(s).toContain("useState<LiveView | null>(null);");
    expect(s).not.toContain("useState<LiveView | null>(shared?.v ?? null)");
    expect(s).toContain("if (shared) setV(shared.v);");
  });
});
