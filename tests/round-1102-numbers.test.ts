/** Round 1 (1102): phones never zoom, and analytics numbers count up on the brief's timings. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CHART_MS, NUMBER_TIMING, bezier, chartMotion, formatOf, stepperOf, timingFor, riseIndex, cssTiming } from "../lib/motion/numbers";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const css = src("app/globals.css");

describe("1102 easing", () => {
  test("cubic-bezier matches its end points and known shapes", () => {
    const out = bezier([0.16, 1, 0.3, 1]);
    expect(out(0)).toBe(0);
    expect(out(1)).toBe(1);
    expect(out(0.5)).toBeGreaterThan(0.9); // expo-like: most of the travel early (why counts moved off it in 1104)
    const lin = bezier([0, 0, 1, 1]);
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) expect(lin(x)).toBeCloseTo(x, 4);
    const io = bezier([0.42, 0, 0.58, 1]);
    expect(io(0.5)).toBeCloseTo(0.5, 3);
    expect(io(0.2)).toBeLessThan(0.2);
  });
  test("monotonic, never overshoots", () => {
    for (const e of Object.values(NUMBER_TIMING)) {
      const f = bezier(e.ease);
      let last = 0;
      for (let i = 1; i <= 100; i++) {
        const y = f(i / 100);
        expect(y).toBeGreaterThanOrEqual(last - 1e-9);
        expect(y).toBeLessThanOrEqual(1 + 1e-9);
        last = y;
      }
    }
  });
});

describe("1102 timings", () => {
  test("the brief's durations", () => {
    expect(NUMBER_TIMING.main.ms).toBe(1200);
    expect(NUMBER_TIMING.main.ease).toEqual([0.33, 1, 0.68, 1]);
    expect(NUMBER_TIMING.secondary.ms).toBe(900);
    expect(NUMBER_TIMING.secondary.ease).toEqual([0.33, 1, 0.68, 1]);
    expect(NUMBER_TIMING.pct.ms).toBe(800);
    expect(NUMBER_TIMING.refresh.ms).toBe(700);
    expect(CHART_MS).toBe(700);
  });
  test("percentages default to pct, a refresh always wins", () => {
    expect(timingFor("pct", undefined, false)).toBe(NUMBER_TIMING.pct);
    expect(timingFor("compact", undefined, false)).toBe(NUMBER_TIMING.secondary);
    expect(timingFor("compact", "main", false)).toBe(NUMBER_TIMING.main);
    expect(timingFor("compact", "main", true)).toBe(NUMBER_TIMING.refresh);
  });
  test("charts: 700ms ease-in-out, off with reduced motion", () => {
    expect(chartMotion(false, 1)).toEqual({ isAnimationActive: true, animationBegin: 160, animationDuration: 700, animationEasing: "ease-in-out" });
    expect(chartMotion(true)).toEqual({ isAnimationActive: false });
    expect(riseIndex(3)).toEqual({ "--i": 3 });
    expect(cssTiming("secondary")).toBe("900ms cubic-bezier(0.33,1,0.68,1)");
  });
});

describe("1102 formats", () => {
  test("final values", () => {
    expect(formatOf("compact")(1234)).toBe("1.2K");
    expect(formatOf("compact")(12_400)).toBe("12K");
    expect(formatOf("count")(1234)).toBe("1,234");
    expect(formatOf("count")(12_400)).toBe("12K");
    expect(formatOf("int")(1234.6)).toBe("1,235");
    expect(formatOf("pct")(4.25)).toBe("4.3%");
    const f = (n: number) => `${n}s`;
    expect(formatOf(f)).toBe(f);
  });
  test("counting keeps the final unit: no K then M flicker", () => {
    const s = stepperOf("compact", 2_400_000); // "2M" at the end
    expect(s(400_000)).toBe("0.4M");
    expect(stepperOf("compact", 2e12)(6e11)).toBe("0.6T"); // trillions hold their unit too
    expect(s(1_600_000)).toBe("2M");
    const k = stepperOf("compact", 4_300); // "4.3K"
    expect(k(500)).toBe("0.5K");
    expect(k(4_250)).toBe("4.3K");
    const big = stepperOf("count", 45_000); // "45K"
    expect(big(9_000)).toBe("9K");
    expect(stepperOf("count", 9_000)(4_321.4)).toBe("4,321");
    expect(stepperOf("compact", 640)(321.4)).toBe("321");
    expect(stepperOf("pct", 12)(6.25)).toBe("6.3%");
  });
  test("every unit along the way matches the final one", () => {
    for (const final of [1_500, 12_345, 980_000, 3_200_000, 7_800_000_000]) {
      const end = formatOf("compact")(final);
      const unit = end.replace(/[\d.,-]/g, "");
      const step = stepperOf("compact", final);
      for (let i = 1; i < 20; i++) expect(step((final * i) / 20).replace(/[\d.,-]/g, "")).toBe(unit);
    }
  });
});

describe("1102 AnimatedNumber", () => {
  const a = src("components/shared/AnimatedNumber.tsx");
  test("one rAF loop writing text through a ref, final frame exact", () => {
    expect(a).toContain("requestAnimationFrame(frame)");
    expect(a).toContain("t.nodeValue = s");
    expect(a).not.toContain("useState");
    expect(a).toMatch(/if \(p >= 1\) \{\s*shown\.current = to;\s*remember\(\);\s*return write\(text\);/);
    // Review 1102: remember only what was shown (finish, jump-past, cleanup), never the target before it counts.
    expect(a).not.toContain("seen.set(id, to)");
    expect(a).toMatch(/return \(\) => \{\s*cancelAnimationFrame\(raf\);\s*clearTimeout\(wait\);\s*io\?\.disconnect\(\);\s*remember\(\);/);
    expect(a).not.toContain("fmt.current = format");
  });
  test("remembers per metric, skips null, honours reduced motion, starts in view", () => {
    expect(a).toContain("const seen = new Map<string, number>()");
    expect(a).toContain("seen.get(id)");
    expect(a).toContain('write("–")');
    expect(a).toContain("prefers-reduced-motion: reduce");
    expect(a).toContain("new IntersectionObserver");
  });
  test("screen readers get the final value only", () => {
    expect(a).toContain('<span ref={el} aria-hidden="true">');
    expect(a).toMatch(/<span className="sr-only">\s*\{text\}\s*\{srSuffix\}/);
  });
});

describe("1102 wiring", () => {
  test("analytics pages use it, charts animate", () => {
    const av = src("components/analytics/AnalyticsView.tsx");
    expect(av).not.toContain("function CountUp");
    expect(av).toContain('<AnimatedNumber value={data.totals.views} tier="main" id="analytics:reach" />');
    expect(av).toContain("{...chartMotion(reduce, i)}");
    expect(av).toContain('cn("kpi-in glass');
    const pd = src("components/analytics/PlatformDashboardView.tsx");
    expect(pd).toContain("<AnimatedNumber value={h.value} format={formatOfHeadline(h)}");
    expect(pd).not.toContain("isAnimationActive={false}");
    expect(pd).toContain('className="kpi-in glass');
    const ls = src("components/analytics/LiveStrip.tsx");
    expect(ls).toContain('<Num p={p} h={lead} tier="main" />');
    expect(ls).not.toContain("{fmt(");
    const ad = src("components/analytics/AccountDrill.tsx");
    expect(ad).toContain('srSuffix=" views"');
    expect(ad).toContain('format="pct"');
  });
  test("Pulse keeps its rolling digits on the brief's timings", () => {
    const r = src("components/dashboard/RollingNumber.tsx");
    expect(r).toContain('curve(first.current ? tier : "refresh")');
    expect(r).not.toContain("900ms cubic-bezier(.2,.8,.2,1)");
    expect(src("components/dashboard/PulseHome.tsx")).toContain('tier={k.key === "eng" ? "pct" : i === 0 ? "main" : "secondary"}');
    expect(src("components/dashboard/ViewsChart.tsx")).toContain("easeInOut(clamp01((now - t0) / 700))");
    expect(src("components/dashboard/Sparkline.tsx")).toContain("duration: 0.7");
  });
  test("cards: 500ms, 12px, 80ms apart; never lift on hover; reduced motion still", () => {
    expect(css).toContain("animation: kpi-rise .5s cubic-bezier(.16,1,.3,1) backwards; animation-delay: calc(var(--i, 0) * 80ms);");
    expect(css).toContain("@keyframes kpi-rise { from { opacity: 0; transform: translateY(12px); } }");
    // 1100: studio cards never move on hover, so they stay off the admin .kpi-card class (which lifts).
    for (const f of ["components/analytics/AnalyticsView.tsx", "components/analytics/PlatformDashboardView.tsx"]) expect(src(f)).not.toContain("kpi-card");
    expect(css.slice(css.indexOf("/* Round 1 (1102): app-like touch."), css.indexOf("1100: pulse rail."))).not.toMatch(/:hover/);
    const rise = css.lastIndexOf(".kpi-in {");
    expect(css.lastIndexOf("@media (prefers-reduced-motion: no-preference) {", rise)).toBeGreaterThan(rise - 120);
  });
});

describe("1102 zoom lock", () => {
  test("viewport never scales", () => {
    const l = src("app/layout.tsx");
    expect(l).toMatch(/viewport: Viewport = \{[^}]*maximumScale: 1, userScalable: false/);
    expect(l).toContain('viewportFit: "cover"');
  });
  test("no double-tap zoom; phone fields at least 16px", () => {
    expect(css).toContain("html { touch-action: manipulation;");
    const m = css.slice(css.indexOf("/* Round 1 (1102): app-like touch."));
    expect(m).toContain("@media (max-width: 767px)");
    expect(m).toContain("textarea, select");
    expect(m).toContain("font-size: max(16px, 1em) !important;");
    expect(m).toContain(':not([type="checkbox"])');
  });
});

describe("1102 home-screen icon", () => {
  // PNG header: width and height at bytes 16-23, colour type at 25 (2 = RGB, 6 = RGBA).
  const png = (f: string) => {
    const b = readFileSync(f);
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), alpha: b[25] === 6 || b[25] === 4 };
  };
  test("the trimmed rocket at every size the phones ask for", () => {
    expect(png("app/apple-icon.png")).toEqual({ w: 180, h: 180, alpha: false }); // iOS turns transparency black
    expect(png("public/brand/app/icon-192.png")).toMatchObject({ w: 192, h: 192 });
    expect(png("public/brand/app/icon-512.png")).toMatchObject({ w: 512, h: 512 });
    expect(png("public/brand/app/icon-512-maskable.png")).toEqual({ w: 512, h: 512, alpha: false }); // full bleed
    const m = src("app/manifest.ts");
    for (const i of ["icon-192.png", "icon-512.png", "icon-512-maskable.png"]) expect(m).toContain(`/brand/app/${i}`);
  });
});
