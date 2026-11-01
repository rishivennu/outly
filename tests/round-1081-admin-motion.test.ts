import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { trendTone } from "@/components/admin/motion/AdminKpi";

const src = (p: string) => readFileSync(p, "utf8");

describe("1081 admin analytics motion: trend colour", () => {
  test("rising is good, falling is bad", () => {
    expect(trendTone([1, 1, 1, 5, 5, 5])).toBe("up");
    expect(trendTone([5, 5, 5, 1, 1, 1])).toBe("down");
  });
  test("invert flips it (churn rising is bad)", () => {
    expect(trendTone([0, 0, 0, 3, 3, 3], true)).toBe("down");
    expect(trendTone([3, 3, 3, 0, 0, 0], true)).toBe("up");
  });
  test("under 5% change, all zero and short series are flat", () => {
    expect(trendTone([100, 100, 100, 102, 102, 102])).toBe("flat");
    expect(trendTone([0, 0, 0, 0])).toBe("flat");
    expect(trendTone([1, 9])).toBe("flat");
  });
});

describe("1081 admin analytics motion: wiring", () => {
  test("Overview KPIs and charts use the analytics motion", () => {
    const page = src("app/admin/(panel)/page.tsx");
    expect(page).toContain("<EnterRoot");
    expect(page).toContain("spark={sp((r) => r.active)}");
    const charts = src("components/admin/OverviewCharts.tsx");
    expect(charts).not.toContain("isAnimationActive={false}");
    expect(charts).toContain("pulse-seg-pill");
    expect(charts).toContain("useSeen");
  });
  test("Growth and Retention use sliding chips, the funnel and the risk meter", () => {
    const g = src("app/admin/(panel)/growth/page.tsx");
    const r = src("app/admin/(panel)/retention/page.tsx");
    expect(g).toContain("<FunnelBars");
    expect(g).toMatch(/FilterChips[^>]*glide/);
    expect(r).toContain("<RiskMeter");
    expect(r).toMatch(/FilterChips glide/);
  });
  test("other admin pages keep the plain chips", () => {
    for (const p of ["users", "tickets", "payments"]) expect(src(`app/admin/(panel)/${p}/page.tsx`)).not.toMatch(/FilterChips[^>]*\bglide\b/);
  });
  test("reduced motion: every new reveal has a no-motion path", () => {
    const css = src("app/globals.css");
    expect(css).toMatch(/prefers-reduced-motion: no-preference\) \{ \.chip-plate/);
    expect(css).toMatch(/prefers-reduced-motion: no-preference\) \{ \.grow-clip/);
    expect(src("components/dashboard/motion.ts")).toMatch(/useSeen[\s\S]*prefersReduced\(\)/);
  });
});
