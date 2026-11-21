// R1288 admin: EasyUI FunnelChart, ActivityHeatmap, NotificationBell motion, CommandMenu, DragToConfirm and AvatarStack,
// ported to components/ui/easy and wired into real admin screens (and the studio bell).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dropText, funnelDrop, funnelSummary } from "@/components/ui/easy/FunnelChart";
import { filterCommands, fuzzyScore } from "@/components/ui/easy/CommandMenu";
import { rollDirection, SHAKE_KEYFRAMES } from "@/components/ui/easy/NotificationBell";
import { CONFIRM_AT, reachedConfirm } from "@/components/ui/easy/DragToConfirm";
import { getInitials, splitStack } from "@/components/ui/easy/AvatarStack";
import { commandEntries, isPaletteShortcut } from "@/components/admin/AdminCommand";
import { weekdayAverages } from "@/components/admin/ActiveDaysCard";
import { can } from "@/lib/admin/perms";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const PORTS = ["FunnelChart", "ActivityHeatmap", "NotificationBell", "CommandMenu", "DragToConfirm", "AvatarStack"];

describe("R1288 ports follow the porting rules", () => {
  test.each(PORTS)("%s carries the MIT credit, Outlly imports and Outlly tokens", (n) => {
    const s = read(`components/ui/easy/${n}.tsx`);
    expect(s.startsWith('"use client";\n/* Ported from EasyUI (https://easyui.site), MIT License, Copyright (c) 2026 Suraj Maurya.\n   Adapted for Outlly in R1288')).toBe(true);
    expect(s).not.toContain("../../lib/");
    expect(s).not.toMatch(/\bdark:/);
    expect(s).not.toMatch(/\b(text|bg|fill|stroke|border)-neutral-/);
    expect(s).not.toMatch(/\bbg-(white|black)\b/);
    expect(s).not.toContain("transition-all");
    expect(s).not.toContain("\u2014");
    expect(s).toContain("useReducedMotion");
  });
});

describe("1. FunnelChart: activation funnel and partner attribution", () => {
  const stages = [{ label: "Signed up", value: 200 }, { label: "Connected", value: 120 }, { label: "Posted", value: 30 }];
  test("summary: overall conversion and the biggest drop", () => {
    const s = funnelSummary(stages)!;
    expect(s.conv).toBe(15);
    expect(s.worst).toBe(1);
    expect(s.dropPct).toBe(75);
    expect(funnelDrop(stages, 0)).toBe(40);
    expect(funnelSummary([stages[0]])).toBeNull();
  });
  test("a later stage larger than the one before reads as a gain, not a loss", () => {
    expect(dropText(40)).toBe("−40%");
    expect(dropText(-25)).toBe("+25%");
    expect(funnelDrop([{ label: "a", value: 0 }, { label: "b", value: 5 }], 0)).toBe(0);
  });
  test("ActivationFunnel renders it from the cohort steps and keeps the step list, rules and copy", () => {
    const f = read("components/admin/ActivationFunnel.tsx");
    expect(f).toContain('import { FunnelChart } from "@/components/ui/easy/FunnelChart";');
    expect(f).toContain("<FunnelChart className=\"mb-5\" stages={f.steps.map((s) => ({ label: s.label, value: s.count }))} formatValue={n}");
    expect(f).toContain("Waitlist, counted on its own");
    expect(f).toContain("skipped an earlier step");
    expect(f).toContain("<details");
  });
  test("AttributionCard: visits, signups, paid as a funnel once there are visits", () => {
    const a = read("components/admin/partners/AttributionCard.tsx");
    expect(a).toContain("{counts.visits > 0 && (");
    expect(a).toContain('stages={[{ label: "Visits", value: counts.visits }, { label: "Signups", value: counts.signups }, { label: "Paid", value: counts.paid }]}');
  });
});

describe("2. ActivityHeatmap: overview calendar of active users", () => {
  test("weekday averages start on Monday and use UTC days", () => {
    // 2026-11-16 is a Monday
    const days = [{ date: "2026-11-16", value: 4 }, { date: "2026-11-23", value: 6 }, { date: "2026-11-22", value: 9 }];
    const a = weekdayAverages(days);
    expect(a.map((x) => x.label)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(a[0].avg).toBe(5);
    expect(a[6].avg).toBe(9);
    expect(a[2].avg).toBe(0);
  });
  test("the overview page feeds the daily series to a 12-week, Monday-first calendar", () => {
    const p = read("app/admin/(panel)/page.tsx");
    expect(p).toContain('import { ActiveDaysCard } from "@/components/admin/ActiveDaysCard";');
    expect(p).toContain("<ActiveDaysCard days={o.series.map((r) => ({ date: r.day, value: r.active }))} />");
    expect(p).toContain("spark={sp((r) => r.active)}");
    const c = read("components/admin/ActiveDaysCard.tsx");
    expect(c).toMatch(/<ActivityHeatmap\s+data=\{days\}\s+weeks=\{12\}\s+weekStart=\{1\}/);
  });
  test("tooltips, keyboard and live readout survive the port", () => {
    const h = read("components/ui/easy/ActivityHeatmap.tsx");
    for (const k of ['"ArrowRight"', '"ArrowDown"', '"Escape"', 'role="status" aria-live="polite"', "<Tooltip", 'color = "hsl(var(--lime))"']) expect(h).toContain(k);
  });
});

describe("3. NotificationBell motion on both bells", () => {
  test("digits roll up when the count grows and down when it falls", () => {
    expect(rollDirection(3, 4)).toBe(1);
    expect(rollDirection("9+", 2)).toBe(-1);
    expect(SHAKE_KEYFRAMES[0]).toBe(0);
    expect(SHAKE_KEYFRAMES.at(-1)).toBe(0);
  });
  test("admin bell keeps its badge, polling and panel, and shakes only after the first check", () => {
    const b = read("components/admin/Bell.tsx");
    expect(b).toContain("const shake = useArrivalShake(unread, loaded);");
    expect(b).toContain("if (first) setLoaded(true);");
    expect(b).toContain('ring-2 ring-background"><BadgeCount value={unread > 9 ? "9+" : unread} /></span>}');
    expect(b).toContain("<BellShake shake={shake}>");
    expect(b).toContain("setInterval(() => (pollable() || backgroundAlerts(live, Date.now() - Math.max(at, shared()), idleFor(), perm())) && run(), 30_000)");
  });
  test("studio notices bell gets the same treatment", () => {
    const n = read("components/shell/NoticesBell.tsx");
    expect(n).toContain("const shake = useArrivalShake(unread, items !== null);");
    expect(n).toContain('<BadgeCount value={unread > 9 ? "9+" : unread} />');
    expect(n).toContain("usePanelPresence(open, panel,");
  });
});

describe("4. CommandMenu: admin Ctrl/Cmd+K palette", () => {
  test("fuzzy filter: in-order characters, title hits before category hits", () => {
    expect(fuzzyScore("Live Support", "lsp")).not.toBeNull();
    expect(fuzzyScore("Payments", "zz")).toBeNull();
    const items = [{ title: "Users", category: "Run" }, { title: "Tickets", category: "Support" }, { title: "Live Support", category: "Support" }];
    expect(filterCommands(items, "support").map((i) => i.title)).toEqual(["Live Support", "Tickets"]);
    expect(filterCommands(items, "")).toEqual(items);
  });
  test("entries come from NAV, filtered by role", async () => {
    const { NAV } = await import("@/components/admin/AdminShell");
    const all = commandEntries(NAV, "super");
    expect(all.length).toBe(NAV.length);
    const sup = commandEntries(NAV, "support");
    expect(sup.every((e) => can("support", NAV.find((n) => n.href === e.href)!.area))).toBe(true);
    expect(sup.length).toBeLessThan(all.length);
    expect(all[0]).toMatchObject({ id: "/admin", title: "Overview", category: "Run" });
  });
  test("shortcut is Ctrl+K or Cmd+K without other modifiers", () => {
    expect(isPaletteShortcut({ key: "k", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(true);
    expect(isPaletteShortcut({ key: "K", ctrlKey: false, metaKey: true, altKey: false, shiftKey: false })).toBe(true);
    expect(isPaletteShortcut({ key: "k", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe(false);
    expect(isPaletteShortcut({ key: "k", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBe(false);
  });
  test("mounted in the admin top bar before the bell, with a md+ trigger and router navigation", () => {
    const s = read("components/admin/AdminShell.tsx");
    const right = s.slice(s.indexOf('<div className="ml-auto'), s.indexOf("</header>"));
    expect(right.indexOf("<AdminCommand nav={NAV} role={admin.role} />")).toBeGreaterThan(-1);
    expect(right.indexOf("<AdminCommand")).toBeLessThan(right.indexOf("<Bell"));
    const c = read("components/admin/AdminCommand.tsx");
    expect(c).toContain("router.push(href)");
    expect(c).toContain("md:inline-flex");
    expect(c).toContain('{mac ? "⌘ K" : "Ctrl K"}');
    expect(c).toContain('className="admin-layer z-[var(--admin-z-dialog)]"');
    const m = read("components/ui/easy/CommandMenu.tsx");
    for (const k of ['role="listbox"', 'role="option"', "aria-activedescendant", '"ArrowDown"', '"ArrowUp"', '"Enter"', "Dialog.Root"]) expect(m).toContain(k);
  });
});

describe("5. DragToConfirm on destructive admin actions", () => {
  test("a release counts only past 85% of the track", () => {
    expect(CONFIRM_AT).toBe(0.85);
    expect(reachedConfirm(85, 100)).toBe(true);
    expect(reachedConfirm(84, 100)).toBe(false);
    expect(reachedConfirm(10, 0)).toBe(false);
  });
  test("keyboard path and 44px thumb survive the port", () => {
    const d = read("components/ui/easy/DragToConfirm.tsx");
    expect(d).toContain('if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight" || e.key === "End") {');
    expect(d).toContain('role="slider"');
    expect(d).not.toMatch(/thumbSize: (?!44)\d+/);
  });
  test("Clear sample data is a slide; Remove admin and maintenance on are unlocked by one", () => {
    const s = read("components/admin/SampleData.tsx");
    expect(s).toContain('<DragToConfirm actionType="delete" label="Slide to clear sample data"');
    expect(s).toContain('onConfirm={() => run("DELETE")}');
    expect(s).toContain("Real data is not touched.");
    const t = read("components/admin/TeamView.tsx");
    expect(t).toContain('confirmLabel="Remove" disabled={!armed} extra={<DragToConfirm');
    expect(t).toContain('<Tooltip text="Remove"><Button variant="danger" size="icon-sm"');
    const m = read("components/admin/MaintenanceToggle.tsx");
    expect(m).toContain("disabled={!armed}");
    expect(m).toContain('ariaLabel="Slide to unlock Turn maintenance on"');
  });
});

describe("6. AvatarStack: team facepile", () => {
  test("initials and the +N split", () => {
    expect(getInitials("Rishi Vennu Naidu")).toBe("RV");
    expect(getInitials("  ")).toBe("?");
    expect(splitStack([1, 2, 3, 4, 5, 6, 7], 5)).toEqual({ visible: [1, 2, 3, 4, 5], remaining: 2 });
  });
  test("TeamView shows the team at the top of People, active members highlighted", () => {
    const t = read("components/admin/TeamView.tsx");
    expect(t).toContain('import { AvatarStack } from "@/components/ui/easy/AvatarStack";');
    expect(t).toContain("avatars={team.map((a) => ({ id: a.id, name: a.id === me ? `${a.name} (you)` : a.name, highlight: a.active }))}");
    expect(t).toContain('size="lg"');
  });
});
