/**
 * 1163 admin kit: regrouped sidebar (Run / Insights / Support / Setup / Administration), slim icon-only mode
 * with tooltips, footer anchored outside the scroll area, shared states (status badge, hint, tooltip, section,
 * loading, error, unavailable), table min-width derived from the column count, and the panel error boundary.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const shell = read("components/admin/AdminShell.tsx");
const ui = read("components/admin/ui.tsx");
const kit = read("components/admin/kit.ts");
const css = read("app/globals.css");

const ROUTES = [
  "/admin", "/admin/users", "/admin/payments", "/admin/pricing", "/admin/campaigns", "/admin/subscriptions", "/admin/plans",
  "/admin/ai-usage", "/admin/referrals", "/admin/behavior", "/admin/retention", "/admin/growth", "/admin/analytics",
  "/admin/tickets", "/admin/live-assist", "/admin/faq", "/admin/outbox", "/admin/integrations", "/admin/platforms", "/admin/landing", "/admin/mascot",
  "/admin/fonts", "/admin/dashboard", "/admin/notifications", "/admin/updates", "/admin/maintenance", "/admin/perf",
  "/admin/waitlist", "/admin/beta", "/admin/founding", "/admin/team",
];

describe("1163 sidebar", () => {
  test("groups are ordered Run, Insights, Content Studio, Support, Setup, Administration", () => {
    // 1175 added Content Studio (the blog agent) between Insights and Support.
    expect(shell).toContain('NAV_GROUPS: readonly NavGroup[] = ["Run", "Insights", "Content Studio", "Support", "Setup", "Administration"]');
  });
  test("every admin destination is still in the nav", () => {
    const hrefs = [...shell.matchAll(/href: "(\/admin[^"]*)"/g)].map((m) => m[1]);
    for (const r of ROUTES) expect(hrefs).toContain(r);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    // 30 from 1163, the six Content Studio pages (1175) and Live Assist (R1184).
    expect(hrefs.length).toBe(37);
    for (const r of ["/admin/blog", "/admin/blog/generate", "/admin/blog/library", "/admin/blog/calendar", "/admin/blog/seo", "/admin/blog/settings"]) expect(hrefs).toContain(r);
  });
  test("insight pages moved out of Run", () => {
    for (const h of ["/admin/behavior", "/admin/retention", "/admin/growth", "/admin/analytics"]) {
      const line = shell.split("\n").find((l) => l.includes(`href: "${h}"`)) ?? "";
      expect(line).toContain('group: "Insights"');
    }
    expect(shell.split("\n").find((l) => l.includes('href: "/admin/team"'))).toContain('group: "Administration"');
  });
  test("slim mode: toggle with labels, persisted, data attribute, tooltips outside the scroll area", () => {
    expect(shell).toContain('SLIM_KEY = "admin:nav:slim"');
    expect(shell).toContain('"Expand sidebar"');
    expect(shell).toContain('"Collapse sidebar"');
    expect(shell).toContain("data-nav=");
    expect(shell).toContain("admin-tip--fixed");
    expect(shell).toContain("onScrollCapture");
  });
  test("footer (account + sign out) is a sibling of the scroll area, not inside it", () => {
    const open = shell.indexOf("<ScrollArea");
    const close = shell.indexOf("</ScrollArea>", open);
    const footer = shell.indexOf("<Footer", open);
    expect(open).toBeGreaterThan(-1);
    expect(footer).toBeGreaterThan(close);
    expect(shell).toContain('href="/admin/account"');
  });
  test("mobile menu + motion hooks preserved, wider content column", () => {
    expect(shell).toContain('aria-label="Open menu"');
    expect(shell).toContain('data-route-order=""');
    expect(shell).toContain("max-w-[1480px]");
    expect(shell).not.toContain("max-w-[1240px]");
  });
  test("hover styles only on hover-capable devices", () => {
    const bare = shell.match(/(^|[\s"])hover:[a-z-]+/g) ?? [];
    expect(bare.length).toBe(0);
  });
});

describe("1163 shared states", () => {
  test("ui.tsx exports the kit pieces", () => {
    for (const name of ["StatusBadge", "Tooltip", "Hint", "Section", "LoadingState", "ErrorState", "Unavailable"]) {
      expect(ui).toMatch(new RegExp(`export function ${name}\\(`));
    }
    expect(ui).toContain("export const STATUS_LABEL");
    expect(ui).toContain("export const tableMinWidth");
  });
  test("status vocabulary covers platforms and deliveries", () => {
    for (const s of ["configured", "connected", "pending_approval", "requires_reconnect", "missing_credentials", "unsupported", "config_error", "sent", "skipped", "queued", "failed", "dead"]) {
      expect(ui).toMatch(new RegExp(`\\b${s}: \\{`));
    }
    expect(ui).toContain('"Held back"');
    expect(ui).toContain('"Accepted"');
  });
  test("table min width grows with the column count and the default uses it", async () => {
    const mod = await import("../components/admin/ui");
    expect(mod.tableMinWidth(2)).toBe(320);
    expect(mod.tableMinWidth(3)).toBe(480);
    expect(mod.tableMinWidth(4)).toBe(640);
    expect(mod.tableMinWidth(6)).toBe(640);
    expect(mod.tableMinWidth(1)).toBe(240);
    expect(ui).toContain("minWidth ?? tableMinWidth(head.length)");
  });
  test("kit.ts exposes the Admin* names from the brief", () => {
    for (const n of ["AdminPageHeader", "AdminSidebar", "AdminMetricCard", "AdminSection", "AdminFilterBar", "AdminDateRangePicker", "AdminChartCard", "AdminDataTable", "AdminStatusBadge", "AdminEmptyState", "AdminLoadingState", "AdminErrorState", "AdminConfirmDialog", "AdminTooltip"]) {
      expect(kit).toContain(n);
    }
  });
  test("metric card explains its comparison period and can be marked unavailable", () => {
    const kpi = read("components/admin/motion/AdminKpi.tsx");
    expect(kpi).toContain("compare");
    expect(kpi).toContain("Unavailable");
    expect(kpi).toContain("No change");
  });
  test("chart card offers a table view and an empty state for all-zero series", () => {
    const chart = read("components/admin/ChartCard.tsx");
    expect(chart).toContain("aria-pressed");
    expect(chart).toContain("allZero");
    const filter = read("components/admin/FilterBar.tsx");
    expect(filter).toContain("export function AdminDateRangePicker");
    expect(filter).toContain("export function ReportMeta");
  });
  test("panel error boundary exists", () => {
    expect(existsSync(join(ROOT, "app/admin/(panel)/error.tsx"))).toBe(true);
    const err = read("app/admin/(panel)/error.tsx");
    expect(err).toContain("ErrorState");
    expect(err).toContain("reset");
  });
  test("tooltip css lives before the 1120 block and no em dashes in new copy", () => {
    const a = css.indexOf("1163: admin tooltip");
    const b = css.indexOf("1120: creator profile card");
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
    for (const src of [shell, ui, kit, read("components/admin/ChartCard.tsx"), read("components/admin/FilterBar.tsx")]) {
      expect(src.includes("\u2014")).toBe(false);
    }
  });
});

describe("1163 pages", () => {
  test("Overview: every metric explains itself, Active subscriptions is gated on money not tickets", () => {
    const page = read("app/admin/(panel)/page.tsx");
    const kpis = page.split("\n").filter((l) => l.includes("<Kpi "));
    expect(kpis.length).toBe(8);
    for (const l of kpis) expect(l).toContain("hint=");
    const ticketsBranch = page.slice(page.indexOf('can(admin.role, "tickets")'));
    expect(ticketsBranch).not.toContain('label="Active subscriptions"');
    const moneyBranch = page.slice(page.indexOf("{money ? ("), page.indexOf('can(admin.role, "tickets")'));
    expect(moneyBranch).toContain('label="Active subscriptions"');
    expect(page).toContain('compare="the 30 days before"');
  });
  test("Overview trends: table view and all-zero state on every chart, 13px axis labels (1165)", () => {
    const c = read("components/admin/OverviewCharts.tsx");
    expect(c).toContain("AdminChartCard");
    expect((c.match(/allZero=\{zero\(/g) ?? []).length).toBe(4);
    expect((c.match(/table=\{tbl\(/g) ?? []).length).toBe(4);
    expect(c).toContain("fontSize: 13"); // 1165 raised the axis from 12 to 13 for readability
    expect(c).not.toContain("fontSize: 11");
  });
  test("emails are masked on the server for non-super roles", async () => {
    const { adminEmail, canSeeEmail } = await import("../lib/admin/privacy");
    expect(canSeeEmail("super")).toBe(true);
    expect(canSeeEmail("support")).toBe(false);
    expect(adminEmail("rishi@example.com", "super")).toBe("rishi@example.com");
    expect(adminEmail("rishi@example.com", "marketing")).toBe("ri****@example.com");
    expect(adminEmail(null, "super")).toBe("");
    const n = read("app/admin/(panel)/notifications/page.tsx");
    expect(n).toContain("adminEmail(r.user.email, role)");
    expect(n).toContain("adminEmail(f.user.email, role)");
    expect(n).not.toMatch(/\{r\.user\.email\}/);
    const b = read("app/admin/(panel)/behavior/page.tsx");
    expect(b).toContain("adminEmail(u.email, admin.role)");
  });
  test("Notifications: results use the shared badge and the counting unit is named", () => {
    const n = read("app/admin/(panel)/notifications/page.tsx");
    expect(n).toContain("<StatusBadge status={r.status} />");
    expect(n).toContain('label: "Reached someone"');
    expect(n).toContain("a channel attempt is one channel's outcome for it");
    expect(n).toContain("Every number is a channel attempt.");
    expect(n).not.toContain('"Delivered"');
  });
});

describe("1163 follow-ups from the screenshot pass", () => {
  test("churn divides by every subscription live in the window, so it can never exceed 100%", () => {
    const m = read("lib/admin/metrics.ts");
    expect(m).toContain("const churnBase = activeAtStart + startedIn30;");
    expect(m).toContain("const churn = churnBase ? canceled30 / churnBase : 0;");
    expect(m).toContain("churn, churnBase, canceled30,");
    const p = read("app/admin/(panel)/page.tsx");
    expect(p).toContain("unavailable={k.churnBase ? undefined :");
    expect(p).toContain("${k.canceled30} of ${k.churnBase} subscriptions cancelled");
  });
  test("KPI cards go single-column under 440px and labels wrap instead of truncating", () => {
    expect(read("app/admin/(panel)/page.tsx")).toContain("grid grid-cols-1 gap-3 min-[440px]:grid-cols-2 lg:grid-cols-4");
    const k = read("components/admin/motion/AdminKpi.tsx");
    expect(k).toContain('<span className="min-w-0 break-words">{label}</span>');
    expect(k).not.toContain("min-w-0 truncate");
    expect(k).toContain("{!unavailable && sub &&");
  });
  test("sidebar footer site link is an icon with a tooltip, so nothing wraps beside the theme toggles", () => {
    const s = read("components/admin/AdminShell.tsx");
    expect(s).toContain('<Tooltip text="View the site" side="top" className="ml-auto flex">');
    expect(s).toContain('aria-label="View the site"');
    expect(s).not.toContain("aria-hidden /> View the site");
  });
  test("starter-password banner text keeps a readable width and the button a 44px target", () => {
    const l = read("app/admin/(panel)/layout.tsx");
    expect(l).toContain('className="min-w-[12rem] flex-1">You\'re still on the starter password');
    expect(l).toContain("inline-flex min-h-11 items-center rounded-full bg-foreground");
  });
});

describe("1163 horizontal overflow guard", () => {
  test("hidden tooltips leave the layout and the panel clips sideways overflow", () => {
    const css = read("app/globals.css");
    expect(css).toContain(".admin-root { overflow-x: clip; }");
    expect(css).toContain(".admin-tipwrap:focus-within > .admin-tip { display: block; opacity: 1; }");
    expect(css).toContain(".admin-tip--fixed { display: block; position: fixed;");
    expect(read("app/admin/(panel)/page.tsx")).toContain("min-[440px]:grid-cols-2 lg:grid-cols-4");
  });
  test("slim toggle persists outside the state updater (strict mode runs updaters twice)", () => {
    const s = read("components/admin/AdminShell.tsx");
    expect(s).toContain("const next = !slim;");
    expect(s).toContain('localStorage.setItem(SLIM_KEY, next ? "1" : "0");');
  });
});
