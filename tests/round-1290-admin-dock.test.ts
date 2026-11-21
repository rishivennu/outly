/**
 * R1290: the admin console's dock. A per-browser choice between the grouped sidebar and a dock along the bottom
 * (desktop only), built on the shared Dock primitive; each sidebar group is one dock icon with a menu of its pages.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NAV, NAV_GROUPS, ADMIN_NAV_KEY, SLIM_KEY, readNavStyle } from "@/components/admin/AdminShell";
import { dockGroups, GROUP_ICON } from "@/components/admin/AdminDock";
import { can } from "@/lib/admin/perms";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const shell = src("components/admin/AdminShell.tsx");
const dock = src("components/admin/AdminDock.tsx");

describe("R1290 preference", () => {
  test("its own per-browser key next to the slim one, sidebar unless the value is exactly dock", () => {
    expect(ADMIN_NAV_KEY).toBe("admin:nav:style");
    expect(SLIM_KEY).toBe("admin:nav:slim");
    expect(readNavStyle("dock")).toBe("dock");
    for (const v of [null, "", "sidebar", "Dock", "rail"]) expect(readNavStyle(v)).toBe("sidebar");
  });
  test("read in a layout effect (before paint), saved on change, mirrored on the shell root", () => {
    expect(shell).toContain("useLayoutEffect(() => {\n    try {\n      setNavStyle(readNavStyle(localStorage.getItem(ADMIN_NAV_KEY)));");
    expect(shell).toContain("localStorage.setItem(ADMIN_NAV_KEY, next);");
    expect(shell).toContain('useState<AdminNavStyle>("sidebar")');
    expect(shell).toContain("data-admin-nav={navStyle}");
  });
});

describe("R1290 shell", () => {
  test("the dock style omits the sidebar aside entirely and renders AdminDock instead", () => {
    const gate = shell.indexOf("{!dock && (");
    const aside = shell.indexOf('aria-label="Admin sidebar"');
    expect(gate).toBeGreaterThan(-1);
    expect(aside).toBeGreaterThan(gate);
    expect(shell.indexOf(")}", aside)).toBeGreaterThan(aside);
    expect(shell).toContain("{dock && <AdminDock ");
    expect((shell.match(/<AdminDock /g) ?? []).length).toBe(1);
  });
  test("content clears the dock on lg, the old padding still applies otherwise", () => {
    expect(shell).toContain('quiet ? "lg:pb-4" : "lg:pb-24", dock && "lg:pb-[calc(6rem+var(--sa-b))]"');
  });
  test("with the sidebar gone the desktop header shows the Admin mark", () => {
    expect(shell).toContain('<div className={cn("flex min-w-0 items-center gap-1.5", !dock && "lg:hidden")}>');
  });
  test("a switch in the sidebar footer and one in the dock, focus moves to the other after switching", () => {
    expect(shell).toContain('aria-label="Switch to the dock"');
    expect(shell).toContain('onDock={() => chooseNav("dock")}');
    expect(shell).toContain('onSidebar={() => chooseNav("sidebar")}');
    expect(dock).toContain('<DockItem label="Switch to sidebar" onClick={onSidebar} attrs={{ "data-admin-nav-switch": "" }}>');
    expect(shell).toContain('document.querySelector<HTMLElement>("[data-admin-nav-switch]")?.focus(');
    // the phone drawer's footer has no dock switch: the dock is desktop only
    expect(shell).toContain('<Footer admin={admin} path={path} onNavigate={() => setOpen(false)} />');
  });
});

describe("R1290 AdminDock", () => {
  test("built on the shared primitive, desktop only, centred at the bottom above the safe area", () => {
    expect(dock).toContain('import { Dock, DockItem, DockSeparator } from "@/components/ui/motion/Dock";');
    expect(dock).toContain("pointer-events-none fixed inset-x-0 z-40 hidden justify-center lg:flex");
    expect(dock).toContain('bottom: "max(16px, var(--sa-b))"');
    expect(dock).toContain('className="pointer-events-auto"');
  });
  test("one icon per group, filtered by can() like the sidebar, Overview kept out of the groups", () => {
    expect(dock).toContain('nav.filter((n) => n.href !== "/admin" && can(role, n.area))');
    expect(Object.keys(GROUP_ICON).sort()).toEqual([...NAV_GROUPS].sort());
    const all = dockGroups(NAV, NAV_GROUPS, "super");
    expect(all.map((g) => g.group)).toEqual([...NAV_GROUPS]);
    expect(all.flatMap((g) => g.items).length).toBe(NAV.length - 1);
    for (const role of ["super", "finance", "support", "marketing"] as const) {
      for (const g of dockGroups(NAV, NAV_GROUPS, role)) {
        expect(g.items.length).toBeGreaterThan(0);
        for (const n of g.items) expect(can(role, n.area)).toBe(true);
      }
    }
  });
  test("group items are menu buttons; the menu has role=menu, arrow keys, Escape back to the trigger, outside click", () => {
    expect(dock).toContain('"aria-haspopup": "menu", "aria-expanded": menu?.key === key');
    expect(dock).toContain('role="menu"');
    expect(dock).toContain('role="menuitem"');
    expect(dock).toContain('if (e.key === "Escape") {');
    expect(dock).toContain("close(true);");
    expect(dock).toContain("trigger(key)?.focus({ preventScroll: true });");
    expect(dock).toContain('key && e.key === "ArrowUp"');
    expect(dock).toContain("ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1");
    expect(dock).toContain('document.addEventListener("pointerdown", onDown);');
    expect(dock).toContain("useEffect(() => setMenu(null), [path]);");
  });
  test("the group holding the current page is active; rows are 44px links on the motion tokens", () => {
    expect(dock).toContain("active={items.some((n) => active(path, n.href))}");
    expect(dock).toContain("min-h-11");
    expect(dock).toContain("rounded-[16px]");
    expect(dock).toContain("{...(reduce ? FX.fade : RISE)}");
    expect(dock).toContain("FX.pop.animate");
  });
  test("search, theme, account (name and role) and sign out are all reachable from the dock", () => {
    expect(dock).toContain('<DockItem label="Search" onClick={openSearch}');
    expect(dock).toContain("theme.set(nextTheme.value)");
    expect(dock).toContain("{ROLE_LABEL[admin.role]} · My account");
    expect(dock).toContain('action="/api/admin/logout" method="post"');
    expect(dock).toContain('role="menuitemcheckbox"');
  });
});

describe("R1290 house rules", () => {
  test("no em-dashes, no spring literals, hover only on hover devices in the menu rows", () => {
    for (const s of [dock, shell]) {
      expect(s).not.toContain("\u2014");
      expect(s).not.toMatch(/stiffness:/);
      expect(s).not.toMatch(/bounce:\s*0\./);
    }
    expect((dock.match(/(^|[\s"])hover:[a-z-]+/g) ?? []).length).toBe(0);
  });
});
