import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { classify, linkIndex, sectionOf, ROUTE_TIMING } from "@/lib/motion/route";

const read = (p: string) => readFileSync(p, "utf8");
const css = read("app/globals.css");
const route = read("lib/motion/route.ts");

describe("route transitions (1065): what kind of move", () => {
  test("first load, refresh and same-path renders never animate", () => {
    expect(classify(null, "/analytics")).toBeNull();
    expect(classify("/analytics", "/analytics")).toBeNull();
    expect(classify("/admin/users", "/admin/users", "/admin")).toBeNull();
  });

  test("a different section is a page move, its direction from the sidebar order", () => {
    expect(classify("/home", "/analytics", "", { order: [0, 3] })).toEqual({ kind: "page", dir: 1 });
    expect(classify("/analytics", "/home", "", { order: [3, 0] })).toEqual({ kind: "page", dir: -1 });
    // Not in the sidebar (a card that links somewhere): forward.
    expect(classify("/home", "/billing", "", { order: [0, -1] })).toEqual({ kind: "page", dir: 1 });
    expect(classify("/admin", "/admin/users", "/admin", { order: [0, 2] })).toEqual({ kind: "page", dir: 1 });
  });

  test("deeper or shallower inside one section is a detail move", () => {
    expect(classify("/admin/tickets", "/admin/tickets/abc", "/admin")).toEqual({ kind: "detail", dir: 1 });
    expect(classify("/admin/tickets/abc", "/admin/tickets", "/admin")).toEqual({ kind: "detail", dir: -1 });
    expect(classify("/admin/users", "/admin/tickets", "/admin")?.kind).toBe("page");
  });

  test("siblings in one tab bar are a tab move, in the direction of the tab picked", () => {
    expect(classify("/analytics", "/analytics/instagram", "", { tab: [0, 1] })).toEqual({ kind: "tab", dir: 1 });
    expect(classify("/analytics/youtube", "/analytics/instagram", "", { tab: [3, 1] })).toEqual({ kind: "tab", dir: -1 });
  });

  test("sections and sidebar matching", () => {
    expect(sectionOf("/admin/tickets/x", "/admin")).toBe("tickets");
    expect(sectionOf("/admin", "/admin")).toBe("");
    expect(sectionOf("/analytics/instagram")).toBe("analytics");
    const nav = ["/home", "/content", "/analytics", "/admin", "/admin/users"];
    expect(linkIndex(nav, "/analytics/instagram")).toBe(2);
    expect(linkIndex(nav, "/admin/users/42")).toBe(4);
    expect(linkIndex(nav, "/nowhere")).toBe(-1);
    expect(linkIndex(["/"], "/home")).toBe(-1);
  });

  test("durations sit inside the brief's ranges", () => {
    expect(ROUTE_TIMING.page.mask).toBeGreaterThanOrEqual(0.3);
    expect(ROUTE_TIMING.page.block).toBeLessThanOrEqual(0.45);
    expect(ROUTE_TIMING.tab.block).toBeGreaterThanOrEqual(0.25);
    expect(ROUTE_TIMING.tab.block).toBeLessThanOrEqual(0.4);
    expect(ROUTE_TIMING.detail.block).toBeLessThanOrEqual(0.45);
  });
});

describe("route transitions (1065): wiring", () => {
  test("one stage for the studio and the admin console", () => {
    expect(read("components/shared/PageTransition.tsx")).toContain("<RouteStage>");
    const admin = read("app/admin/(panel)/template.tsx");
    expect(admin).toContain('<RouteStage base="/admin">');
    expect(admin).not.toContain("pageStagger");
  });

  test("the stage keys on the pathname only, so filters and ?tab= never replay", () => {
    const stage = read("components/shared/RouteStage.tsx");
    expect(stage).toContain("usePathname");
    expect(stage).not.toContain("useSearchParams");
  });

  test("every inline style is cleared, nothing elastic, reduced motion only fades", () => {
    expect(route).toMatch(/const CLEAR = "[^"]*clipPath[^"]*"/);
    expect(route).not.toMatch(/ease: "[^"]*(elastic|back|bounce)/);
    expect(route).toContain("if (reduced())");
    expect(route).not.toMatch(/filter:|blur\(/);
    expect(css).toMatch(/\.route-skel[^{]*\.route-slow|\.route-slow[^{]*\.route-skel|\.route-skel,[\s\S]{0,200}animation: none/);
  });

  test("both sidebars give the order, and every item shares one moving pill", () => {
    expect(read("components/shell/Nav.tsx")).toContain('data-route-order=""');
    expect(read("components/admin/AdminShell.tsx")).toContain('data-route-order=""');
    expect((read("components/shell/Nav.tsx").match(/layoutId="nav-pill"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  test("studio loaders arrive with the stage instead of a separate spinner", () => {
    const dirs = ["home", "content", "calendar", "inbox", "settings", "accounts", "billing", "analytics", "analytics/[platform]"];
    for (const d of dirs) {
      const src = read(`app/(studio)/${d}/loading.tsx`);
      expect(src).toContain("RouteSkeleton");
      expect(src).not.toContain("FunLoader");
    }
    expect(read("app/(studio)/loading.tsx")).toContain("RouteSkeleton");
    expect(read("app/admin/(panel)/loading.tsx")).toContain("data-route-skeleton");
  });

  test("analytics keeps its tab bar mounted across tabs", () => {
    expect(read("app/(studio)/analytics/layout.tsx")).toContain("AnalyticsTabsBar");
    expect(read("components/analytics/AnalyticsView.tsx")).not.toContain("<PlatformTabs");
    expect(read("components/analytics/PlatformDashboardView.tsx")).not.toContain("<PlatformTabs");
    expect(read("components/analytics/PlatformTabs.tsx")).toContain("data-route-tabs");
    expect(read("components/analytics/PlatformTabs.tsx")).toContain("data-route-static");
  });

  test("admin lists settle in place when filters change", () => {
    for (const p of ["users", "tickets", "payments", "retention", "growth"]) expect(read(`app/admin/(panel)/${p}/page.tsx`)).toContain("<DataSwap k=");
  });

  test("route pages stay server components", () => {
    const pages = readdirSync("app/(studio)", { recursive: true }) as string[];
    for (const f of pages.filter((x) => /(^|[\\/])(page|layout)\.tsx$/.test(x))) {
      const src = read(`app/(studio)/${f}`);
      if (f.includes("analytics")) expect(src.startsWith('"use client"')).toBe(false);
    }
  });
});
