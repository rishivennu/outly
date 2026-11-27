// R1280 admin strokes (StrokeA: Run + Insights routes and the kit). The bright grey card frame on the phone was the
// stale high-contrast preference (dark --border 240 4% 55% painted by the HC card rule); the key moved to a v2 name so
// that preference resets once. The rest pins the soft-line, single-edge and radius rules on these files.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CONTRAST_KEY } from "@/lib/theme/script";

const read = (f: string) => readFileSync(f, "utf8");
const css = read("app/globals.css").replace(/\r\n/g, "\n");

const FILES = [
  "components/admin/ui.tsx",
  "components/admin/SearchBox.tsx",
  "components/admin/FilterBar.tsx",
  "components/admin/Pagination.tsx",
  "components/admin/ChartCard.tsx",
  "components/admin/Switch.tsx",
  "components/admin/motion/AdminKpi.tsx",
  "components/admin/users/CustomerOverview.tsx",
  "components/admin/users/StoragePanel.tsx",
  "components/admin/health/SystemHealth.tsx",
  "components/admin/PlanGrantsPanel.tsx",
  "components/admin/OverviewCharts.tsx",
  "components/admin/ActivationFunnel.tsx",
  "components/admin/BehaviorAnalyses.tsx",
  "components/admin/BehaviorBreakdown.tsx",
  "components/admin/BehaviorView.tsx",
  "components/admin/ReferralsPanel.tsx",
  "components/admin/CampaignsPanel.tsx",
  "components/admin/AiAccessPanel.tsx",
  "components/admin/AiEngineCard.tsx",
  "components/admin/OutboxView.tsx",
  "app/admin/(panel)/subscriptions/_components/RiskPanel.tsx",
];

describe("R1280 root cause", () => {
  test("the high-contrast preference key moved, so the stale 'more' value no longer applies", () => {
    expect(CONTRAST_KEY).toBe("outly-contrast-v2");
  });
});

describe("R1280 no hard strokes in the Run and Insights files", () => {
  test.each(FILES)("%s has no ring-border frame, hairline, white border or ring, or 1px shadow frame", (f) => {
    const s = read(f);
    for (const bad of ["ring-1 ring-border", "border-white", "ring-white", "shadow-[0_0_0_1px"]) expect(s).not.toContain(bad);
    expect(s).not.toMatch(/\bhairline\b/);
  });
  test.each(FILES)("%s keeps admin radii to 24 (card), 16 (nested), 12 (fields) or full", (f) => {
    const odd = [...read(f).matchAll(/rounded-\[(\d+)px\]/g)].map((m) => Number(m[1])).filter((n) => ![24, 16, 12].includes(n));
    expect(odd).toEqual([]);
  });
  test("status edges stay at or under 40% alpha", () => {
    expect(read("components/admin/ui.tsx")).toContain('s?.strong && "ring-1 ring-inset ring-warning/40"');
    expect(read("components/admin/AiEngineCard.tsx")).toContain("ring-1 ring-[hsl(var(--lime)/0.4)]");
    expect(read("components/admin/SearchBox.tsx")).toContain('"border-[hsl(var(--lime)/0.4)] bg-[hsl(var(--lime)/0.16)] font-semibold"');
  });
  test("a health KPI with a status draws one edge (an inset ring replaces the card line), never a border on top of it", () => {
    const s = read("components/admin/health/SystemHealth.tsx");
    expect(s).toContain('tone === "bad" ? "ring-1 ring-inset ring-destructive/40"');
    expect(s).not.toMatch(/"border border-(destructive|warning|success)\//);
    expect(s).toContain('<Card as="div" className={cn("p-4 sm:p-4", edge)}>');
  });
  test("the filter select is a field: border-border/60 at rest, 12px radius", () => {
    // R1342: R1308 split the class list so the toolbar variant (inline) can be a 36px pill; the field look is the default.
    const s = read("components/admin/SearchBox.tsx");
    expect(s).toContain('"cursor-pointer appearance-none border pl-3.5');
    expect(s).toContain('inline ? "h-9 rounded-full touch:h-11" : "h-11 rounded-xl"');
    expect(s).toContain('"border-border/60 bg-secondary/60 font-medium"');
  });
  test("Empty and ErrorState are nested surfaces (16px)", () => {
    const s = read("components/admin/ui.tsx");
    expect(s).toContain("gap-2 rounded-2xl bg-destructive/[0.06] px-5 py-5");
    expect(s).toContain("gap-2 rounded-2xl border border-dashed border-border/70 px-6");
  });
  test("the Users panels sit at the card radius and divide rows with the soft edge token", () => {
    for (const f of ["components/admin/users/CustomerOverview.tsx", "components/admin/users/StoragePanel.tsx"]) {
      const s = read(f);
      expect(s).toContain("cx-panel rounded-[24px]");
      expect(s).not.toContain("divide-[hsl(var(--cx-line))]");
      expect(s).toContain("divide-[hsl(var(--cx-edge))]");
    }
  });
});

describe("R1280 admin line tokens (globals.css, applied by the lead from css-patch.md)", () => {
  const block = css.slice(css.indexOf("/* R1280 admin strokes a */"), css.indexOf("/* end R1280 admin strokes a */"));
  test("the block exists before the 1100 marker", () => {
    expect(css.indexOf("/* R1280 admin strokes a */")).toBeGreaterThan(0);
    expect(css.indexOf("/* R1280 admin strokes a */")).toBeLessThan(css.indexOf("/* ---------- 1100: Liquid glass on every studio card"));
  });
  test("the Users cx edge is a low-alpha line in both themes", () => {
    expect(css).toContain(":root { --cx-panel: 36 60% 97.5%; --cx-edge: 30 30% 20% / .09; --cx-line: 30 30% 89%; }");
    expect(css).toContain(".dark { --cx-panel: 30 8% 9%; --cx-edge: 0 0% 100% / .06; --cx-line: 30 8% 17%; }");
    expect(css).toContain(".cx-tile-go { border: 1px solid hsl(var(--foreground) / .07);");
  });
  test("phone glass buttons in the admin take the card line and a quieter top rim in dark", () => {
    expect(block).toContain("html.dark .admin-root, html.dark .admin-layer { --gb-line: var(--admin-card-line); --gb-hi: 0 0% 100% / .07; }");
  });
  test("the phone table cards use the card line at the nested radius, --border only under high contrast", () => {
    expect(css).toMatch(/padding: \.875rem 1rem; border-radius: 16px;\n    background: hsl\(var\(--foreground\) \/ \.025\); box-shadow: inset 0 0 0 1px hsl\(var\(--admin-card-line/);
    expect(block).toContain('html[data-contrast="more"] .atable--cards > table > tbody > tr { box-shadow: inset 0 0 0 1px hsl(var(--border)); }');
  });
  test("no transform or transition in the block", () => {
    expect(block).not.toMatch(/transform|transition/);
  });
});
