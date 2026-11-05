/** 1141: what the admin's Notifications screen reads, and the house rules the new screens must keep. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../lib/db";
import { categoryCounts, deadLetters, deliverySummary, failedDeliveries, notifyOverview, pendingQueue, queueState, skipReasons, subscriptionCounts } from "../lib/admin/notifications";
import { logDeliveries } from "../lib/notify-log";
import { recordEvent } from "../lib/notify-engine";

const src = (f: string) => readFileSync(join(import.meta.dir, "..", f), "utf8").replace(/\r\n/g, "\n");
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const mkUser = () => db.user.create({ data: { name: "Admin Probe", email: `a-${uniq()}@test.dev`, passwordHash: "x" } });

describe("1141 admin numbers are counts of rows, not estimates", () => {
  test("every channel is summed by result", async () => {
    const u = await mkUser();
    await logDeliveries(u.id, "new_comment", [
      { channel: "inapp", status: "sent" },
      { channel: "push", status: "skipped", reason: "quiet_hours" },
      { channel: "email", status: "failed", detail: "provider refused" },
      { channel: "push", status: "queued" },
    ]);
    const rows = await deliverySummary(1);
    const push = rows.find((r) => r.channel === "push")!;
    expect(push.skipped).toBeGreaterThan(0);
    expect(push.queued).toBeGreaterThan(0);
    expect(push.total).toBe(push.sent + push.skipped + push.failed + push.queued);
    expect(rows.find((r) => r.channel === "email")!.failed).toBeGreaterThan(0);
  });

  test("skip reasons come back most common first", async () => {
    const u = await mkUser();
    for (let i = 0; i < 3; i++) await logDeliveries(u.id, "new_comment", [{ channel: "push", status: "skipped", reason: "cooldown" }]);
    const rows = await skipReasons(1);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].count).toBeGreaterThanOrEqual(rows[rows.length - 1].count);
    expect(rows.some((r) => r.reason === "cooldown")).toBe(true);
  });

  test("categories are reported with the name creators see", async () => {
    const u = await mkUser();
    await logDeliveries(u.id, "post_live", [{ channel: "inapp", status: "sent" }]);
    const rows = await categoryCounts(1);
    expect(rows.find((r) => r.id === "publishing")?.title).toBe("Publishing");
  });

  test("the queue reports what is waiting and what is being retried", async () => {
    const u = await mkUser();
    const key = `q:${uniq()}`;
    await recordEvent({ userId: u.id, kind: "new_comment", source: "test", idemKey: key, payload: { title: "A", body: "B", key } });
    const q = await queueState();
    expect(q.pending).toBeGreaterThan(0);
    expect(q.oldest).not.toBeNull();
    const list = await pendingQueue(5);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].priority).toBeGreaterThan(0);
  });

  test("failed deliveries and dead letters are readable with who they belong to", async () => {
    const u = await mkUser();
    await logDeliveries(u.id, "new_comment", [{ channel: "push", status: "failed", reason: "push_error", detail: "410 gone" }]);
    const rows = await failedDeliveries(5);
    expect(rows[0].user.email).toBeTruthy();
    expect(await deadLetters(5)).toBeInstanceOf(Array);
  });

  test("reach is counted from real subscriptions", async () => {
    const s = await subscriptionCounts();
    expect(s.web).toBeGreaterThanOrEqual(0);
    expect(s.people).toBeLessThanOrEqual(s.web + 1);
  });

  test("the overview answers in one call with the window it used", async () => {
    const o = await notifyOverview();
    expect(o.days).toBe(7);
    expect(o.channels).toBeInstanceOf(Array);
    expect(o.queue.pending).toBeGreaterThanOrEqual(0);
  });
});

describe("1141 house rules in the new screens", () => {
  const files = [
    "components/admin/NotificationsPanel.tsx",
    "app/admin/(panel)/notifications/page.tsx",
    "components/settings/notifications/NotificationSettings.tsx",
    "components/onboarding/SetupChecklist.tsx",
    "lib/notify-config-core.ts",
    "lib/retention/assistant.ts",
    "lib/retention/digest.ts",
  ];

  for (const f of files) {
    test(`${f}: plain words, no emoji and no em dashes`, () => {
      const s = src(f);
      expect(s).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      expect(s).not.toMatch(/[\u2014]/);
    });
  }

  test("the admin screen keeps its own area, so no new permission is invented", () => {
    expect(src("app/admin/(panel)/notifications/page.tsx")).toContain('requireAdmin("site")');
    expect(src("app/api/admin/notifications/route.ts")).toContain('adminRoute("site"');
  });

  test("a test send can only reach the admin's own account", () => {
    const s = src("app/api/admin/notifications/route.ts");
    expect(s).toContain("admin.login.toLowerCase()");
    expect(s).toContain("SELF_ONLY");
  });

  test("the notification centre tabs are keyboard reachable and marked for a screen reader", () => {
    const s = src("components/settings/notifications/NotificationSettings.tsx");
    expect(s).toContain('role="tablist"');
    expect(s).toContain('aria-selected={tab === t.id}');
    expect(s).toContain("nf-tab-n"); // the count, so a group is never told by colour alone
  });

  test("the tab styles keep a visible focus ring and respect reduced motion", () => {
    const css = src("app/globals.css");
    const block = css.slice(css.indexOf("NOTIFY round 1141"), css.indexOf("1100: Liquid glass"));
    expect(block).toContain(".nf-tab:focus-visible");
    expect(block).toContain("min-height: 44px");
    expect(block).toContain("prefers-reduced-motion");
    expect(block).not.toContain("outline: none");
  });

  test("the onboarding steps read the device, never the server", () => {
    const s = src("components/onboarding/SetupChecklist.tsx");
    expect(s).toContain("provenInstalled");
    expect(s).toContain("permission()");
    expect(s).toContain('href="/settings/notifications#nf-device"');
  });

  test("the sweeper calls the engine once and never lets it break the sweep", () => {
    const s = src("app/api/cron/sweep/route.ts");
    expect(s).toContain("sweepNotify()");
    expect(s).toContain('console.error("[sweep] notify", e)');
  });
});
