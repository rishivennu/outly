/** 1164: the Notifications screen counts in two units, notifications and channel attempts, and never mixes them. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../lib/db";
import { countNotifications, greetingProblems, groupDeliveries, groupKey, outcomeOf, renderGreeting, type DeliveryLite } from "../lib/admin/notifications-core";
import { notificationCounts, deliverySummary, notifyAudit } from "../lib/admin/notifications";
import { adminEvent } from "../lib/admin/route";
import { logDeliveries } from "../lib/notify-log";

const src = (f: string) => readFileSync(join(import.meta.dir, "..", f), "utf8").replace(/\r\n/g, "\n");
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const mkUser = () => db.user.create({ data: { name: "Count Probe", email: `c-${uniq()}@test.dev`, passwordHash: "x" } });
const at = new Date("2026-11-10T10:00:00Z");
const row = (p: Partial<DeliveryLite>): DeliveryLite => ({ userId: "u1", kind: "goal_nudge", category: "growth", channel: "inapp", status: "sent", eventId: null, noticeId: null, createdAt: at, ...p });

describe("1164 pure counting model", () => {
  test("rows from one decision share a key: by event, else by notice, else by the second they were written", () => {
    expect(groupKey(row({ eventId: "e1", noticeId: "n1" }))).toBe("u1|goal_nudge|e1");
    expect(groupKey(row({ noticeId: "n1" }))).toBe("u1|goal_nudge|n1");
    expect(groupKey(row({}))).toBe(groupKey(row({ channel: "push", createdAt: new Date(at.getTime() + 400) })));
    expect(groupKey(row({}))).not.toBe(groupKey(row({ createdAt: new Date(at.getTime() + 1000) })));
    expect(groupKey(row({}))).not.toBe(groupKey(row({ userId: "u2" })));
  });

  test("outcome: any acceptance wins, then waiting, then failed, else held back", () => {
    expect(outcomeOf([{ status: "skipped" }, { status: "sent" }])).toBe("reached");
    expect(outcomeOf([{ status: "skipped" }, { status: "queued" }])).toBe("waiting");
    expect(outcomeOf([{ status: "skipped" }, { status: "failed" }])).toBe("failed");
    expect(outcomeOf([{ status: "skipped" }, { status: "skipped" }])).toBe("held");
  });

  test("the 170 / 124 / 286 shape: attempts per group exceed held-back attempts, notifications are fewer than both", () => {
    const rows: DeliveryLite[] = [];
    // 100 creators, one growth nudge each: bell accepted, push held back (no device), email held back (off) = 3 attempts
    for (let i = 0; i < 100; i++) {
      const id = `n${i}`;
      rows.push(row({ userId: `u${i}`, noticeId: id }), row({ userId: `u${i}`, noticeId: id, channel: "push", status: "skipped" }), row({ userId: `u${i}`, noticeId: id, channel: "email", status: "skipped" }));
    }
    const c = countNotifications(rows);
    expect(c.attempts).toBe(300);
    expect(c.notifications).toBe(100);
    expect(c.recipients).toBe(100);
    expect(c.reached).toBe(100);
    expect(c.held).toBe(0);
    const g = c.byCategory.find((x) => x.id === "growth")!;
    expect(g.notifications).toBe(100);
    expect(g.attempts).toBe(300);
    expect(g.sent + g.skipped + g.failed + g.queued).toBe(g.attempts);
    expect(g.skipped).toBe(200);
  });

  test("outcomes partition the notifications, and recipients are distinct people", () => {
    const rows = [
      row({ noticeId: "a" }), row({ noticeId: "a", channel: "push", status: "skipped" }),
      row({ userId: "u2", noticeId: "b", status: "skipped" }), row({ userId: "u2", noticeId: "b", channel: "push", status: "skipped" }),
      row({ userId: "u2", eventId: "e3", status: "skipped" }), row({ userId: "u2", eventId: "e3", channel: "push", status: "failed" }),
      row({ userId: "u3", eventId: "e4", status: "skipped" }), row({ userId: "u3", eventId: "e4", channel: "push", status: "queued" }),
    ];
    const c = countNotifications(rows);
    expect(c.notifications).toBe(4);
    expect(c.recipients).toBe(3);
    expect(c.reached + c.held + c.failed + c.waiting).toBe(c.notifications);
    expect([c.reached, c.held, c.failed, c.waiting]).toEqual([1, 1, 1, 1]);
    expect(c.lastSentAt.inapp).toEqual(at);
    expect(groupDeliveries(rows).map((g) => g.rows.length)).toEqual([2, 2, 2, 2]);
  });
});

describe("1164 database-backed counts reconcile with the attempt table", () => {
  test("one logDeliveries call is one notification, however many channels", async () => {
    const u = await mkUser();
    const notice = await db.notice.create({ data: { userId: u.id, kind: "goal_nudge", tone: "info", title: "t", body: "b", key: `k:${uniq()}` } });
    await logDeliveries(u.id, "goal_nudge", [{ channel: "inapp", status: "sent" }, { channel: "push", status: "skipped", reason: "no_device" }, { channel: "email", status: "skipped", reason: "email_off" }], { noticeId: notice.id });
    const c = await notificationCounts(1);
    const mine = await db.notifyDelivery.count({ where: { userId: u.id } });
    expect(mine).toBe(3);
    expect(c.attempts).toBeGreaterThanOrEqual(3);
    expect(c.notifications).toBeLessThan(c.attempts);
    expect(c.reached + c.held + c.failed + c.waiting).toBe(c.notifications);
    expect(c.titles.growth).toBe("Growth");
    const channels = await deliverySummary(1);
    expect(channels.reduce((s, x) => s + x.total, 0)).toBe(c.attempts);
    expect(channels.find((x) => x.channel === "inapp")!.lastSentAt).not.toBeNull();
  });
});

describe("1164 the screen and the test send", () => {
  test("KPIs are notification-level with hints, the by-group pills are a table, no Pill import remains", () => {
    const p = src("app/admin/(panel)/notifications/page.tsx");
    expect(p).toContain('label: "Notifications", v: n.notifications');
    expect(p).toContain('label: "Reached someone", v: n.reached');
    expect(p).toContain('label: "Held back entirely", v: n.held');
    expect(p).toContain('head={["Channel", "Attempts", "Accepted", "Held back", "Failed", "Waiting", "Last accepted"]}');
    expect(p).toContain('head={["Group", "Notifications", "Attempts", "Accepted", "Held back", "Failed", "Waiting"]}');
    expect(p).not.toContain("over.categories.map");
    expect(p).not.toContain("Pill");
    expect(p).toContain("min-[440px]:grid-cols-2 lg:grid-cols-4");
  });
  test("the test send reports what each channel said, is audited, and still refuses any other address", () => {
    const r = src("app/api/admin/notifications/route.ts");
    expect(r).toContain("SELF_ONLY");
    expect(r).toContain("where: r.id ? { noticeId: r.id }");
    expect(r).toContain('adminEvent("notify_test"');
    expect(r).toContain("devices, channels });");
    const c = src("components/admin/NotificationsPanel.tsx");
    expect(c).toContain("What each channel said");
    expect(c).toContain("<StatusBadge status={c.status} />");
    expect(c).toContain("Accepted means the provider took it, not that it was seen.");
  });
});

describe("1164 settings copy and guards", () => {
  test("greeting lines: only {name} is a placeholder, typos and stray braces are refused, preview mirrors the engine", () => {
    expect(greetingProblems(["Good morning, {name}.", "Morning."])).toEqual([]);
    expect(greetingProblems(["Hi {nmae}"])[0]).toContain("{nmae}");
    expect(greetingProblems(["Hi {name"])[0]).toContain("stray brace");
    expect(greetingProblems([])).toEqual(["Write at least one line, or switch this greeting off instead."]);
    expect(greetingProblems(["x".repeat(121)])[0]).toContain("longer than 120");
    expect(renderGreeting("Good morning, {name}.", "Asha")).toBe("Good morning, Asha.");
    expect(renderGreeting("Good morning, {name}.", "  ")).toBe("Good morning, there.");
  });

  test("the pause audit trail reads the events the routes already write, newest first, as ISO strings", async () => {
    await adminEvent("notify_pause", "Notifications paused", "Probe Admin paused every push and email that is not essential.", "/admin/notifications");
    const a = await notifyAudit(5);
    expect(a.length).toBeGreaterThan(0);
    expect(a[0].kind).toBe("notify_pause");
    expect(a[0].body).toContain("Probe Admin paused");
    expect(typeof a[0].at).toBe("string");
    expect(Number.isNaN(Date.parse(a[0].at))).toBe(false);
    expect(a.every((e) => e.kind === "notify_pause" || e.kind === "notify_test")).toBe(true);
    await db.adminEvent.deleteMany({ where: { body: { contains: "Probe Admin paused" } } });
  });

  test("the panel explains zero cooldowns, the away clock, the summary window, and validates greetings before saving", () => {
    const c = src("components/admin/NotificationsPanel.tsx");
    expect(c).toContain("No wait: every one in this group buzzes as it happens.");
    expect(c).toContain("COOLDOWN_MIN[b.id]");
    expect(c).toContain("the moment they come back the clock restarts");
    expect(c).toContain("What they see after");
    expect(c).toContain("Only pushes a cooldown held back are counted");
    expect(c).toContain("const problems = greetingProblems(lines);");
    expect(c).toContain("if (problems.length) return;");
    expect(c).toContain('role="alert"');
    expect(c).toContain("Recent changes from this screen");
    expect(c).toContain("Last changed <span suppressHydrationWarning>{ago(lastPause.at)}</span>");
    const p = src("app/admin/(panel)/notifications/page.tsx");
    expect(p).toContain("notifyAudit()");
    expect(p).toContain("audit={audit}");
  });

  test("PATCH accepts one cooldown, one idle step or one greeting at a time (zod 4 z.record demands every key, which 400ed every such save)", () => {
    const r = src("app/api/admin/notifications/route.ts");
    expect(r).toContain("const Cooldown = z.partialRecord(");
    expect(r).toContain("const Idle = z.partialRecord(");
    expect(r).toContain("const Greet = z.partialRecord(");
    expect(r).not.toContain("z.record(z.enum(");
  });
});
