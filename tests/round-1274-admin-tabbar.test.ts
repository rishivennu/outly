/**
 * R1274: the admin gets the studio's phone tab bar. Four destinations from NAV plus More (the one admin drawer),
 * role gated with a fallback inside each group, compact on the header's own fold signal, and the content keeps
 * clear of it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NAV, active } from "@/components/admin/AdminShell";
import { adminTabs } from "@/components/admin/AdminTabBar";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const bar = src("components/admin/AdminTabBar.tsx");
const shell = src("components/admin/AdminShell.tsx");
const css = src("app/globals.css");
const block = css.slice(css.indexOf("/* R1274 admin tabbar */"), css.indexOf("/* end R1274 */"));

const hrefs = (role: Parameters<typeof adminTabs>[1], path = "/admin") => adminTabs(NAV, role, path, active).tabs.map((t) => t.href);

describe("R1274 tabs per role", () => {
  test("super admin: Overview, Users, Blog dashboard, Tickets", () => {
    expect(hrefs("super")).toEqual(["/admin", "/admin/users", "/admin/blog", "/admin/tickets"]);
  });
  test("a tab the role cannot open falls back inside its group or is left out, never a route the role cannot open", () => {
    expect(hrefs("support")).toEqual(["/admin", "/admin/users", "/admin/tickets"]);
    expect(hrefs("finance")).toEqual(["/admin", "/admin/users", "/admin/outbox"]);
    expect(hrefs("marketing")).toEqual(["/admin", "/admin/referrals", "/admin/blog", "/admin/outbox"]);
  });
});

describe("R1274 current tab", () => {
  const on = (path: string) => {
    const r = adminTabs(NAV, "super", path, active);
    return r.moreOn ? "more" : r.tabs.find((t) => t.on)!.href;
  };
  test("own route, group membership, and More for everything else", () => {
    expect(on("/admin")).toBe("/admin");
    expect(on("/admin/users/abc")).toBe("/admin/users");
    expect(on("/admin/blog/library")).toBe("/admin/blog");
    expect(on("/admin/blog/seo")).toBe("/admin/blog");
    expect(on("/admin/live-assist")).toBe("/admin/tickets");
    expect(on("/admin/faq")).toBe("/admin/tickets");
    expect(on("/admin/payments")).toBe("more");
    expect(on("/admin/team")).toBe("more");
    expect(on("/admin/account")).toBe("more");
  });
  test("exactly one tab is current", () => {
    for (const path of ["/admin", "/admin/users", "/admin/blog", "/admin/tickets", "/admin/health", "/admin/account"]) {
      const r = adminTabs(NAV, "super", path, active);
      expect(r.tabs.filter((t) => t.on).length + (r.moreOn ? 1 : 0)).toBe(1);
    }
  });
});

describe("R1274 markup", () => {
  test("the studio's .mtab structure, named, with aria-current", () => {
    expect(bar).toContain('aria-label="Admin tabs"');
    expect(bar).toContain('className="admin-tabbar mtab fixed inset-x-0 z-[var(--admin-z-header)] flex items-stretch lg:hidden"');
    expect(bar).toContain('<span className="mtab-ind" aria-hidden="true" />');
    expect(bar).toContain('className="mtab-pill relative grid h-[32px] w-[56px] place-items-center"');
    expect((bar.match(/className="mtab-item /g) ?? []).length).toBe(2);
    expect(bar).toContain('aria-current={on ? "page" : undefined}');
    expect(bar).toContain('<span className="sr-only">{label}</span>');
    expect(bar).toContain("data-compact={compact ? \"\" : undefined}");
    expect(bar).toContain('["--i" as string]: idx');
  });
  test("More opens the dialog and says so", () => {
    const more = bar.slice(bar.indexOf("<button"), bar.indexOf("</button>"));
    expect(more).toContain('aria-haspopup="dialog"');
    expect(more).toContain("aria-expanded={open}");
    expect(more).toContain('aria-label="More"');
    expect(more).toContain("min-h-11");
    expect(more).toContain("focus-visible:ring-2");
    expect(more).not.toContain("active:scale");
    expect((bar.match(/<button\b/g) ?? []).length).toBe(1);
  });
  test("tabs derive from NAV; no route literal outside the preferred slots", () => {
    expect(shell).toContain("nav={NAV}");
    expect(shell).toContain("active={active}");
    expect(bar).not.toMatch(/href="\/admin/);
  });
});

describe("R1274 shell wiring", () => {
  test("one scroll hook; the bar compacts on the header's fold", () => {
    expect((shell.match(/useHeaderScroll\(/g) ?? []).length).toBe(1);
    expect(bar).not.toContain("useHeaderScroll");
    expect(bar).not.toContain("useCompactOnScroll");
    expect(shell).toContain("compact={hidden}");
  });
  test("More reuses the one drawer and focus goes back to it", () => {
    expect((shell.match(/<Dialog.Root /g) ?? []).length).toBe(1);
    expect(shell).toContain("fromTab.current = true;");
    expect(shell).toContain("if (fromTab.current) moreBtn.current?.focus({ preventScroll: true });");
    expect(shell).toContain("ref={moreBtn}");
  });
  test("content clears the bar under lg; desktop padding unchanged", () => {
    expect(shell).toContain("pb-[calc(var(--sa-float)+1rem)]");
    expect(shell).toContain('quiet ? "lg:pb-4" : "lg:pb-24"');
  });
  test("header: the studio bar's 52px row plus the inset, a 44px menu button with the studio icon weight", () => {
    expect(shell).toContain("box-content flex h-[52px] items-center");
    expect(shell).toContain('<Menu className="h-5 w-5" strokeWidth={1.85} aria-hidden />');
  });
  test("CSS: float token under lg, More hover fix, z documented, before the 1100 marker", () => {
    expect(css.indexOf("/* R1274 admin tabbar */")).toBeGreaterThan(-1);
    expect(css.indexOf("/* R1274 admin tabbar */")).toBeLessThan(css.indexOf("/* ---------- 1100: Liquid glass on every studio card"));
    expect(block).toContain("@media (max-width: 1023.98px) {\n  .admin-root { --admin-bottom-float: calc(var(--sa-b) + 84px); }");
    expect(block).toContain(".mtab.admin-tabbar:has(> button.mtab-item:hover) .mtab-ind { translate: calc((var(--n, 5) - 1) * 100%) 0; }");
    expect(block).toContain("--admin-z-header");
    expect(block).not.toContain("transition");
    // the studio bar's reduced-motion rule already stops the compact scale from animating
    expect(css).toContain("@media (prefers-reduced-motion: reduce) {\n  .mtab, .mtab-item, .mtab-pill, .mtab-pill > svg, .mtab-ind, .mtab-ind::before, .mtab-ripple { transition: none; }");
  });
});
