// R1288 studio: EasyUI StatCard, AnimatedTabs, PullToRefresh, PaymentStatus and Skeleton, wired into real screens.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StatCard } from "../components/ui/easy/StatCard";
import { PaymentStatus } from "../components/ui/easy/PaymentStatus";
import { SkeletonReveal } from "../components/ui/easy/Skeleton";
import { PULL_COPY, dampedPull } from "../components/ui/easy/PullToRefresh";
import { canPull } from "../components/home/HomeRefresh";
import { Skeleton } from "../components/shared/Skeleton";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const PORTS = ["StatCard", "AnimatedTabs", "PullToRefresh", "PaymentStatus", "Skeleton"].map((n) => `components/ui/easy/${n}.tsx`);
const env = (q: Record<string, boolean>, standalone = false) => ({
  matchMedia: (s: string) => ({ matches: !!q[s] }),
  navigator: { standalone },
  document: { documentElement: { hasAttribute: () => false } },
});

describe("R1288 ports follow the porting rules", () => {
  test("MIT header, Outlly imports, no dark: classes, no neutral literals, no em dashes", () => {
    for (const f of PORTS) {
      const s = read(f);
      expect(s.startsWith('"use client";\n/* Ported from EasyUI (https://easyui.site), MIT License, Copyright (c) 2026 Suraj Maurya.'), f).toBe(true);
      expect(s, f).not.toContain("../../lib/");
      expect(s, f).not.toMatch(/\bdark:/);
      expect(s, f).not.toMatch(/text-neutral-|bg-neutral-|bg-white\b|bg-black\b|#0E0E0E|#1F1F1F/);
      expect(s, f).not.toContain("\u2014");
    }
    expect(read("components/ui/easy/PullToRefresh.tsx")).not.toContain("FinancialStatsCard");
  });
});

describe("1. StatCard on the analytics KPI row", () => {
  const view = read("components/analytics/AnalyticsView.tsx");
  test("the row is a StatGrid of StatCards that keeps the rise and the honest notes", () => {
    expect(view).toContain('import { StatCard, StatGrid } from "@/components/ui/easy/StatCard";');
    expect(view).toContain('<StatGrid min={150} className="mt-10 sm:gap-3">');
    expect(view).toContain('className={cn("kpi-in glass rounded-[22px]", i === all.length - 1 && all.length % 2 === 1 && "max-sm:col-span-full")}');
    expect(view).toContain("style={riseIndex(i)}");
    expect(view).toContain("Not reported by");
    expect(view).not.toContain("<dl className=\"mt-10 grid");
  });
  test("views and engagement draw their series, comparisons only when fair", () => {
    expect(view).toContain("values: data.series.map((row) => PLATFORMS.reduce((n, p) => n + (row[p] ?? 0), 0)),");
    expect(view).toContain("data.engagementSeries.filter((p): p is { date: string; value: number } => p.value !== null)");
    expect(view).toContain("pointsTrend(data.totals.engagement, data.previous.engagement, data.totals.views, data.previous.views, data.periods, data.coverage)");
    expect(view).toContain("delta: change,");
    expect(view).toContain("sparkline={!!k && k.values.length > 1}");
    expect(view).toContain("delta={k ? k.delta : null}");
  });
  test("renders the value, the delta pill and the scrubbable line", () => {
    const html = renderToStaticMarkup(createElement(StatCard, { label: "Views", value: 1200, trend: [10, 40, 25, 60], delta: 12, animated: false, format: (n: number) => String(Math.round(n)) }));
    expect(html).toContain('aria-label="Views: 1200, up 12%"');
    expect(html).toContain("12%");
    expect(html).toContain("<svg");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("text-success-ink");
  });
  test("no series: same height box, no line, no pill, not focusable; goodWhen down flips the colour", () => {
    const flat = renderToStaticMarkup(createElement(StatCard, { label: "Likes", value: 40, trend: [40], sparkline: false, delta: null, animated: false }));
    expect(flat).not.toContain("<svg");
    expect(flat).not.toContain("tabindex");
    expect(flat).toContain("height:64px");
    const down = renderToStaticMarkup(createElement(StatCard, { label: "Churn", value: 3, trend: [5, 3], delta: -20, goodWhen: "down", animated: false }));
    expect(down).toContain("text-success-ink");
    const note = renderToStaticMarkup(createElement(StatCard, { label: "Views", value: 3, trend: [1, 3], delta: null, deltaNote: "No history", animated: false }));
    expect(note).toContain("No history");
  });
});

describe("2. AnimatedTabs pill on the analytics tabs", () => {
  const tabs = read("components/analytics/PlatformTabs.tsx");
  test("the platform tabs slide the EasyUI indicator and keep their links and state", () => {
    expect(tabs).toContain('import { AnimatedTabIndicator } from "@/components/ui/easy/AnimatedTabs";');
    expect(tabs).toContain('{active && <AnimatedTabIndicator layoutId="an-tab" className="gseg-pane hairline" />}');
    expect(tabs).toContain('aria-current={active ? "page" : undefined}');
    expect(tabs).toContain('aria-label={connected[t.platform] ? "connected" : "not connected"}');
    expect(tabs).toContain("focus-visible:outline-ring");
    expect(tabs).not.toContain("T.glide");
  });
  test("the indicator uses springMorph and jumps under reduced motion", () => {
    const a = read("components/ui/easy/AnimatedTabs.tsx");
    expect(a).toContain("transition={reduce ? { duration: 0 } : motionTransitions.springMorph}");
    expect(a).toContain('role="tablist"');
    expect(a).toContain('e.key === "ArrowRight"');
  });
});

describe("3. PullToRefresh on Home", () => {
  test("Home is wrapped in both views", () => {
    const page = read("app/(studio)/home/page.tsx");
    expect(page).toContain('import { HomeRefresh } from "@/components/home/HomeRefresh";');
    expect(page).toContain("if (view) return <HomeRefresh>{view}</HomeRefresh>;");
    expect(page).toContain("return <HomeRefresh>{await classicView(user, dash.canSwitch, searchParams?.recapAt, setup, nonce, true)}</HomeRefresh>;");
  });
  test("only the installed app with a coarse pointer", () => {
    expect(canPull(env({ "(display-mode: standalone)": true, "(pointer: coarse)": true }))).toBe(true);
    expect(canPull(env({ "(pointer: coarse)": true }, true))).toBe(true);
    expect(canPull(env({ "(display-mode: standalone)": true }))).toBe(false);
    expect(canPull(env({ "(pointer: coarse)": true }))).toBe(false);
  });
  test("refresh resolves after the router transition; the gesture only arms at the top and yields upward", () => {
    const h = read("components/home/HomeRefresh.tsx");
    expect(h).toContain("start(() => router.refresh());");
    expect(h).toContain("if (!pending && done.current) {");
    const p = read("components/ui/easy/PullToRefresh.tsx");
    expect(p).toContain("armed = !scrolledAbove(e.target as Element | null);");
    expect(p).toContain("if (dy < 0) return reset();");
    expect(p).toContain('window.addEventListener("touchmove", move, { passive: false });');
    expect(p).toContain("<motion.div style={{ y: reduce ? 0 : y }}>{children}</motion.div>");
    expect(p).toContain('<RefreshCw className={cn("h-3.5 w-3.5", status === "refreshing" && "animate-spin")} />');
  });
  test("the resistance curve never passes the max and is zero for upward travel", () => {
    expect(dampedPull(-20, 68, 110, 0.45)).toBe(0);
    expect(dampedPull(10_000, 68, 110, 0.45)).toBeLessThanOrEqual(110);
    expect(dampedPull(80, 68, 110, 0.45)).toBeLessThan(dampedPull(160, 68, 110, 0.45));
    expect(PULL_COPY.ready).toBe("Release to refresh");
  });
});

describe("4. PaymentStatus on checkout and the receipt", () => {
  const mock = read("components/billing/MockCheckout.tsx");
  test("success is staged verifying then confirmed, with the existing copy", () => {
    expect(mock).toContain('import { PaymentStatus, PaymentStatusIcon } from "@/components/ui/easy/PaymentStatus";');
    expect(mock).toContain('status={confirmed ? "success" : "verifying"}');
    expect(mock).toContain('title={confirmed ? "Payment successful" : "Confirming your payment"}');
    expect(mock).toContain("Your invoice is on its way to {email}. Taking you back…");
    expect(mock).toContain("setTimeout(() => router.replace(`/billing?paid=${j.invoice ?? \"\"}`), 1100);");
    expect(mock).toContain("if (reduce) return setConfirmed(true);");
  });
  test("failure shows the recovery state: mark, reason, retry and another way to pay", () => {
    expect(mock).toContain('{state === "failed" && <PaymentStatusIcon status="failed" size="sm" className="shrink-0" />}');
    expect(mock).toContain('{error}{state === "failed" && " Nothing was charged."}');
    expect(mock).toContain('{other === "upi" ? "Pay with UPI instead" : "Pay by card instead"}');
    expect(mock).toContain('{state === "failed" ? "Try again" : `Pay ${amount}`}');
  });
  test("the paid receipt stamp draws its tick", () => {
    const r = read("components/billing/PaymentReceipt.tsx");
    expect(r).toContain('import { DrawnCheck } from "@/components/ui/easy/PaymentStatus";');
    expect(r).toContain("<DrawnCheck animate={animate} delay={(700 + rows.length * 90) / 1000} strokeWidth={3} className=\"h-6 w-6\" />");
  });
  test("renders title and message", () => {
    const html = renderToStaticMarkup(createElement(PaymentStatus, { status: "success", title: "Payment successful", message: "Done" }));
    expect(html).toContain("Payment successful");
    expect(html).toContain("M20 6L9 17l-5-5");
  });
});

describe("5. Skeleton sweep and SkeletonReveal", () => {
  test("shared Skeleton keeps its API and class, adds the module sweep", () => {
    const html = renderToStaticMarkup(createElement(Skeleton, { className: "h-4" }));
    expect(html).toContain("skeleton rounded-2xl");
    expect(html).toContain('aria-hidden="true"');
    const s = read("components/shared/Skeleton.tsx");
    expect(s).toContain('import styles from "./Skeleton.module.css";');
    expect(s).toContain('export { SkeletonReveal } from "@/components/ui/easy/Skeleton";');
    expect(s).toContain("export function PageSkeleton(");
    const css = read("components/shared/Skeleton.module.css");
    expect(css).toContain(".sweep:global(.skeleton) {");
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.sweep::after \{ animation: none;/);
  });
  test("SkeletonReveal shows a status while loading and the content after", () => {
    const busy = renderToStaticMarkup(createElement(SkeletonReveal, { loading: true, skeleton: createElement("i", null, "s"), children: "real" }));
    expect(busy).toContain('role="status"');
    expect(busy).not.toContain("real");
    const done = renderToStaticMarkup(createElement(SkeletonReveal, { loading: false, skeleton: "s", children: "real" }));
    expect(done).toContain("real");
  });
  test("Home ideas reveal over their placeholder", () => {
    const idea = read("components/home/IdeaBank.tsx");
    expect(idea).toContain('import { Skeleton, SkeletonReveal } from "@/components/shared/Skeleton";');
    expect(idea).toContain("loading={ideas === null}");
    expect(idea).toContain('<Skeleton className="h-28" />');
  });
});
