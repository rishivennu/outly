// R1304 admin design variant 2 ("Aurora"): the console ships two design systems. Classic is the existing AdminShell,
// untouched; Aurora (components/admin/aurora) is a second shell with top pill navigation, a soft canvas and large
// rounded cards, with its own light and dark looks. The pick is a per-admin cookie the server layout reads, so the
// right shell paints first; both shells render the same pages, loaders and APIs.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const AURORA = "components/admin/aurora";
const css = read(`${AURORA}/aurora.css`);
const shell = read(`${AURORA}/AuroraShell.tsx`);
const nav = read(`${AURORA}/AuroraNav.tsx`);
const drawer = read(`${AURORA}/AuroraDrawer.tsx`);
const motion = read(`${AURORA}/motion.ts`);
const overview = read(`${AURORA}/Overview.tsx`);
const kpi = read(`${AURORA}/AuroraKpi.tsx`);
const layout = read("app/admin/(panel)/layout.tsx");
const page = read("app/admin/(panel)/page.tsx");
const account = read("app/admin/(panel)/account/page.tsx");

describe("R1304 preference", () => {
  test("design.ts is server-safe and the cookie is scoped to the console", async () => {
    const d = await import("@/lib/admin/design");
    expect(d.ADMIN_DESIGNS).toEqual(["classic", "aurora"]);
    expect(d.readDesign(undefined)).toBe("classic");
    expect(d.readDesign("nonsense")).toBe("classic");
    expect(d.readDesign("aurora")).toBe("aurora");
    expect(d.designCookie("aurora")).toBe("outly-admin-design=aurora; Path=/admin; Max-Age=31536000; SameSite=Lax");
    expect(read("lib/admin/design.ts")).not.toContain('"use client"');
    expect(read("lib/admin/design.ts")).not.toMatch(/from "react"|document|window/);
  });
  test("the server layout reads the cookie and picks the shell; the classic path and its pinned banner are unchanged", () => {
    expect(layout).toContain('import { AuroraShell } from "@/components/admin/aurora/AuroraShell";');
    expect(layout).toContain('import "@/components/admin/aurora/aurora.css";');
    expect(layout).toContain("const design = readDesign((await cookies()).get(ADMIN_DESIGN_COOKIE)?.value);");
    expect(layout).toContain('const Shell = design === "aurora" ? AuroraShell : AdminShell;');
    expect(layout).toContain("<Shell admin={{ name: admin.name, role: admin.role }} badges={{ tickets: openTickets, live: liveWaiting }}>");
    expect(layout).toContain("robots: { index: false, follow: false }, ...adminAppMeta((await cookies()).get(THEME_COOKIE)?.value) };");
  });
  test("the overview page branches on the same data (nothing fetched twice) and keeps the classic grid", () => {
    expect(page).toContain('if (readDesign((await cookies()).get(ADMIN_DESIGN_COOKIE)?.value) === "aurora") {');
    expect(page).toContain("<AuroraOverview admin={{ name: admin.name, role: admin.role }} o={o} live={live} blog={blog} denied={searchParams.denied} />");
    expect(page.indexOf("const [o, live, blog] = await Promise.all(")).toBeLessThan(page.indexOf("<AuroraOverview"));
    expect(page).toContain("min-[440px]:grid-cols-2 lg:grid-cols-4");
    expect((page.match(/overview\(90\)/g) ?? []).length).toBe(1);
  });
  test("My account carries the picker, and the switch writes cookie + localStorage then cross-fades a refresh", () => {
    expect(account).toContain("<DesignPicker current={design} />");
    const sw = read(`${AURORA}/DesignSwitch.tsx`);
    expect(sw).toContain("document.cookie = designCookie(next)");
    expect(sw).toContain("localStorage.setItem(ADMIN_DESIGN_KEY, next)");
    expect(sw).toContain("start(() => router.refresh())");
    expect(sw).toMatch(/return crossfade\(/);
    expect(read(`${AURORA}/DesignPicker.tsx`)).toContain('name="admin-design"');
  });
});

describe("R1304 V1 untouched", () => {
  test("the classic shell and kit know nothing about Aurora", () => {
    for (const f of ["components/admin/AdminShell.tsx", "components/admin/AdminDock.tsx", "components/admin/AdminTabBar.tsx", "components/admin/ui.tsx", "components/admin/kit.ts", "components/admin/motion/AdminKpi.tsx", "components/admin/motion/EnterRoot.tsx", "app/globals.css"]) {
      expect(read(f)).not.toMatch(/aurora/i);
    }
    // the classic shell still exports the nav model Aurora reads, and still renders its own header and dock
    const s = read("components/admin/AdminShell.tsx");
    expect(s).toContain("export const NAV_GROUPS");
    expect(s).toContain("export const active =");
    expect(s).toContain('className="admin-top sticky top-0');
  });
});

describe("R1304 Aurora shell", () => {
  test("root, landmarks and reuse of the shared controls", () => {
    expect(shell).toContain('"use client"');
    expect(shell).toContain('className="admin-root aurora sky-host relative isolate flex min-h-dvh flex-col" data-admin-design="aurora"');
    expect(shell).toContain('<main id="main" className="admin-main aurora-main');
    expect(shell).toContain("<AdminCommand nav={NAV} role={admin.role} />");
    expect(shell).toContain("<Bell role={admin.role} />");
    expect(shell).toContain("<ThemeToggle compact plain");
    expect(shell).toContain('<DesignSwitch current="aurora" />');
    // parity with classic's sidebar footer: high contrast is reachable on desktop, not only in the drawer
    expect(shell).toContain("<ContrastToggle label={false}");
    // the entrance stage is Stage.tsx's alone
    expect(shell).not.toContain("data-aurora-stage");
    expect(shell).toContain('<form action="/api/admin/logout" method="post"');
    expect(shell).not.toMatch(/import ".*\.css"/);
  });
  test("navigation: groups as pills, pages as tabs with one sliding ink, aria-current on both", () => {
    expect(nav).toContain('import { NAV, NAV_GROUPS, active, type NavGroup } from "@/components/admin/AdminShell";');
    expect(nav).toContain('<nav aria-label="Sections"');
    expect(nav).toContain('aria-current={on ? "page" : undefined}');
    // a group pill links to its first page, so it is the current location, not the current page
    expect(nav).toContain('aria-current={on ? "location" : undefined}');
    expect(nav).toContain('data-aurora="tab"');
    // the ink follows the active tab's own size (a badge arriving) and marks the strip once placed
    expect(nav).toContain("if (active) ro.observe(active);");
    expect(nav).toContain('s.dataset.inkReady = ""');
    expect(nav).toContain("live = false;");
    expect(nav).toContain('data-aurora-ink=""');
    expect(nav).toContain("slideInk(i, el, s, placed.current === key)");
    expect(nav).toContain("gsap.killTweensOf(i)");
    expect(nav).toContain("can(role, n.area)");
    expect(nav).toContain('"Content Studio": "Content"');
  });
  test("the drawer is a Radix dialog inside the aurora scope with a title", () => {
    expect(drawer).toContain('import * as Dialog from "@radix-ui/react-dialog"');
    expect(drawer).toContain("admin-layer aurora");
    expect(drawer).toContain("<Dialog.Title");
    expect(drawer).toContain("au-sheet");
  });
});

describe("R1304 Aurora motion", () => {
  test("everything runs on the shared GSAP instance with the console's eases and durations", () => {
    expect(motion).toContain('import { gsap, useGSAP, countUp, settleCounts } from "@/lib/motion/gsap";');
    expect(motion).toContain("GSAP_EASE.out");
    expect(motion).not.toMatch(/back\.|elastic\.|bounce\./);
    expect(motion).not.toMatch(/scrub:/);
    expect(motion).toContain("if (!window.matchMedia(MOTION_OK).matches)");
    expect(motion).toContain('clearProps: "transform,opacity,animation"');
    expect(motion).toContain("revertOnUpdate: true");
    expect(motion).toContain("startViewTransition");
    // nothing runs past 0.7 s and the stagger wave is capped (STAGGER_CAP) however many cards a page has
    expect(motion).toMatch(/countDur: 0\.[0-6]\d*,/);
    expect(motion).toContain("AURORA_FX.staggerCap / Math.max(1, cards.length - 1)");
    // the CSS reveal hands over to GSAP: no server-rendered card paints solid and then snaps to transparent
    expect(motion).toContain('root.dataset.auroraJs = ""');
    expect(motion).not.toContain("liftOn");
  });
  test("the design switch settles its cross-fade when the shell swap unmounts it, then puts focus back", () => {
    const sw = read(`${AURORA}/DesignSwitch.tsx`);
    expect(sw).toContain("useEffect(() => settle, []);");
    expect(sw).toContain("window.clearTimeout(timer);");
    expect(sw).toContain(".then(() => whenDesign(next))");
    expect(sw).toContain(".then(() => refocus(origin))");
    expect(sw).toContain('if (origin === "picker") await when(() => !!document.querySelector(PICKER_CHECKED), 3000);');
    expect(sw).toContain("new MutationObserver(");
    expect(sw).toContain("mo.disconnect();");
    expect(sw).toContain('[data-design-picker] input[name="admin-design"]:checked');
    const picker = read(`${AURORA}/DesignPicker.tsx`);
    expect(picker).toContain('switchTo(d, "picker")');
    expect(picker).toContain("aria-busy={pending || undefined}");
    expect(picker).not.toContain("<fieldset disabled");
    expect(picker).not.toContain("CardTitle");
  });
  test("the stage runs the entrance once per route and the counters land on data-count", () => {
    const stage = read(`${AURORA}/Stage.tsx`);
    expect(stage).toContain("useAuroraEnter(ref, [path])");
    expect(kpi).toContain('data-aurora="count" data-count={value}');
  });
});

describe("R1304 Aurora overview", () => {
  test("a server composition fed by the same data, with every classic number and gate", () => {
    expect(overview).not.toContain('"use client"');
    expect(overview).toContain("<AuroraStage");
    for (const label of ["Active today", "Total users", "Monthly recurring revenue", "Revenue, 30 days", "Churn, 30 days", "Failed payments, 7 days", "Active subscriptions", "Open tickets"]) expect(overview).toContain(`label: "${label}"`);
    expect(overview).toContain('can(role, "payments")');
    expect(overview).toContain('can(role, "tickets")');
    expect(overview).toContain('can(role, "users")');
    expect(overview).toContain("<OverviewCharts series={o.series}");
    expect(overview).toContain("<LiveGlobeCard initial={live} />");
    expect(overview).toContain("<ActiveDaysCard days=");
    expect(overview).toContain("<TodayBlogCard post={blog.post} job={blog.job} ready={blogReady()} compact />");
    expect(overview).toContain('role === "super" && <SampleData hasSample={o.sample} />');
    expect(overview).not.toMatch(/await |fetch\(|from "@\/lib\/db"/);
  });
  test("the hero is a real heading and the stat cards carry the kit hooks", () => {
    expect(overview).toMatch(/<h1 id="au-hero-title" className="[^"]*text-\[28px\]/);
    expect(kpi).toContain('className="admin-card kpi-card au-stat');
    expect(kpi).toContain('data-tone={good ? "up" : "down"}');
  });
});

describe("R1304 Aurora theme", () => {
  const topLevel = css.split("\n").filter((l) => /^[.\w\[:#]/.test(l) && !l.startsWith("@"));
  test("every rule is scoped under the aurora root or layer, so Classic never sees it", () => {
    const bad = topLevel.filter((l) => !/^(\.dark )?\.admin-(root|layer)\.aurora|^html(\.dark)?\[data-contrast="more"\] \.admin-(root|layer)\.aurora/.test(l));
    expect(bad).toEqual([]);
    expect(topLevel.length).toBeGreaterThan(60);
  });
  test("light and dark token sets, canvas, header, pills, ink, cards, tables, inputs, drawer and preferences", () => {
    expect(css).toMatch(/^\.admin-root\.aurora,\n\.admin-layer\.aurora \{[^}]*--background:/m);
    expect(css).toMatch(/^\.dark \.admin-root\.aurora,\n\.dark \.admin-layer\.aurora \{[^}]*--background:/m);
    expect(css).toMatch(/^\.dark \.admin-root\.aurora,\n\.dark \.admin-layer\.aurora \{[^}]*--card:/m);
    for (const sel of [".admin-root.aurora::before", ".au-header", ".au-pill[aria-current]", ".au-tab", ".au-ink", ".admin-card", ".kpi-card", ".au-hero", ".au-delta[data-tone=\"up\"]", ".atable", ".au-sheet", ".au-sheet-handle", ".au-chip", ".au-brand-pill"]) expect(css).toContain(sel);
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (prefers-reduced-transparency: reduce)");
    expect(css).toContain('html[data-contrast="more"]');
    expect(css).not.toContain("\u2014");
    // the pre-hydration reveal (mirrors EnterRoot) and the no-JS active tab, both scoped to aurora
    expect(css).toContain("@keyframes au-in");
    expect(css).toContain('.admin-root.aurora [data-aurora-stage]:not([data-aurora-js]) [data-aurora="card"]');
    expect(css).toContain('.admin-root.aurora .au-tabs > :not([data-ink-ready]) .au-tab[aria-current="page"]');
    expect(css).not.toContain(":has(.au-ink)");
    // the pill rail is a desktop control: the scoped rule, not only the utility class, keeps it off phones
    expect(css).toMatch(/\.admin-root\.aurora \.au-nav \{\n  display: none;/);
    expect(css).toContain(".admin-root.aurora .au-nav { display: inline-flex; margin-inline: auto; }");
    expect(css).toContain(".admin-root.aurora .au-menu-btn { display: none; }");
    // type is never shouted and each control carries one focus ring (the Tailwind one in its markup)
    expect(css).not.toContain("text-transform: uppercase");
    expect(css).not.toContain(":focus-visible");
  });
  test("the ink fills the strip height so it sits exactly behind a tab", () => {
    expect(css).toMatch(/\.au-ink \{[^}]*top: 0;[^}]*bottom: 0;/);
  });
});

describe("R1304 additive only", () => {
  test("every Aurora file is new, LF, and lives in its own folder", () => {
    const files = readdirSync(AURORA);
    expect(files.sort()).toEqual(["AuroraDrawer.tsx", "AuroraKpi.tsx", "AuroraNav.tsx", "AuroraShell.tsx", "DesignPicker.tsx", "DesignSwitch.tsx", "Highlights.tsx", "Overview.tsx", "Stage.tsx", "aurora.css", "motion.ts"]);
    for (const f of files) expect(readFileSync(`${AURORA}/${f}`, "utf8")).not.toContain("\r\n");
    expect(existsSync("lib/admin/design.ts")).toBe(true);
  });
});
