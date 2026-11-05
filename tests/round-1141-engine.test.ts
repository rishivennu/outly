/** 1141: the central notification engine. Priority, cooldowns, the global pause, the event queue with its
 *  dead letters, the delivery log, the assistant's greetings and inactivity steps, and the summaries. */
import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../lib/db";
import {
  CENTRE_TABS,
  COOLDOWN_MIN,
  GREET_HOUR,
  NOTIFY_DEFAULTS,
  applyPatch,
  assistDefaults,
  assistOn,
  bucketOf,
  centreKinds,
  centreTabOf,
  cooldownFor,
  decide,
  kindsInBucket,
  parseNotifyPrefs,
  priorityOf,
  serializeNotifyPrefs,
} from "../lib/notify-core";
import { IDLE_TIERS, NOTIFY_CONFIG_DEFAULT, mergeNotifyConfig } from "../lib/notify-config-core";
import { forgetNotifyConfig, notifyConfig, saveNotifyConfig } from "../lib/notify-config";
import { assistKey, dueIdleTier, dueSlot, minutesAway, pickLine } from "../lib/notify-assist";
import { MAX_ATTEMPTS, drainEvents, processEvent, pruneEvents, recordEvent, recordEvents, registerHandler } from "../lib/notify-engine";
import { deliveryStats, logDeliveries, plannedRows } from "../lib/notify-log";
import { notify } from "../lib/retention/notices";
import { greetBody, recordGreeting, sweepGreetings, sweepInactivity } from "../lib/retention/assistant";
import { digestSlot, sweepDigests } from "../lib/retention/digest";

const TZ = "Asia/Kolkata";
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const mkUser = (data: Record<string, unknown> = {}) => db.user.create({ data: { name: "Nina Patel", email: `n-${uniq()}@test.dev`, passwordHash: "x", timezone: TZ, ...data } });

beforeEach(() => {
  forgetNotifyConfig();
});

describe("1141 priority and cooldown rules", () => {
  test("a failed post outranks a nudge", () => {
    expect(priorityOf("post_failed")).toBe(1);
    expect(priorityOf("payment_failed")).toBe(1);
    expect(priorityOf("greet")).toBe(4);
    expect(priorityOf("something_new")).toBe(3); // an unknown kind sits in the middle, never first
  });

  test("every kind with a cooldown names a bucket, and the bucket lists it back", () => {
    for (const kind of ["new_comment", "post_failed", "greet", "milestone"]) {
      const b = bucketOf(kind)!;
      expect(b).toBeTruthy();
      expect(kindsInBucket(b)).toContain(kind);
    }
    expect(bucketOf("not_a_kind")).toBeNull();
  });

  test("the admin's override wins, but only when it is a sensible number", () => {
    expect(cooldownFor("new_comment")).toBe(COOLDOWN_MIN.engagement);
    expect(cooldownFor("new_comment", { engagement: 15 })).toBe(15);
    expect(cooldownFor("new_comment", { engagement: -1 })).toBe(COOLDOWN_MIN.engagement);
    expect(cooldownFor("not_a_kind", { engagement: 15 })).toBe(0);
  });

  test("inside the cooldown the bell still gets it and only the buzzing stops", () => {
    const now = new Date("2026-11-05T10:00:00Z");
    const d = decide(NOTIFY_DEFAULTS, "new_comment", now, TZ, { cooldownMin: 10, lastInBucketAt: new Date(now.getTime() - 60_000) });
    expect(d.wanted).toBe(true);
    expect(d.bell).toBe(true);
    expect(d.push).toBe(false);
    expect(d.cooled).toBe(true);
    expect(d.reason).toBe("cooldown");
  });

  test("outside the cooldown nothing is held back", () => {
    const now = new Date("2026-11-05T10:00:00Z");
    const d = decide(NOTIFY_DEFAULTS, "new_comment", now, TZ, { cooldownMin: 10, lastInBucketAt: new Date(now.getTime() - 11 * 60_000) });
    expect(d.push).toBe(true);
    expect(d.cooled).toBe(false);
  });

  test("the global pause quiets the phone but never an essential alert", () => {
    const now = new Date("2026-11-05T10:00:00Z");
    const paused = decide(NOTIFY_DEFAULTS, "new_comment", now, TZ, { paused: true });
    expect(paused.bell).toBe(true);
    expect(paused.push).toBe(false);
    expect(paused.paused).toBe(true);
    const essential = decide(NOTIFY_DEFAULTS, "reconnect", now, TZ, { paused: true, cooldownMin: 999, lastInBucketAt: now });
    expect(essential.push).toBe(true);
  });
});

describe("1141 assistant switches", () => {
  test("defaults greet in the morning and the evening only", () => {
    const a = assistDefaults();
    expect([a.greet.morning, a.greet.afternoon, a.greet.evening, a.greet.night]).toEqual([true, false, true, false]);
    expect(a.inactivity && a.growth && a.summary).toBe(true);
  });

  test("every greeting slot off means no greeting at all", () => {
    const p = applyPatch(NOTIFY_DEFAULTS, { assist: { greet: { morning: false, evening: false } } });
    expect(assistOn(p, "greet")).toBe(false);
    expect(decide(p, "greet", new Date(), TZ).wanted).toBe(false);
    expect(assistOn(p, "inactivity")).toBe(true);
  });

  test("one switch off stops that nudge and nothing else", () => {
    const p = applyPatch(NOTIFY_DEFAULTS, { assist: { growth: false } });
    expect(decide(p, "growth", new Date(), TZ).wanted).toBe(false);
    expect(decide(p, "summary", new Date(), TZ).wanted).toBe(true);
  });

  test("settings saved before the assistant existed keep the assistant's own defaults", () => {
    const old = JSON.stringify({ ev: { post_live: false }, lead: 15 });
    expect(parseNotifyPrefs(old).assist).toEqual(assistDefaults());
  });

  test("a saved choice survives a round trip", () => {
    const p = applyPatch(NOTIFY_DEFAULTS, { assist: { greet: { night: true }, inactivity: false } });
    const back = parseNotifyPrefs(serializeNotifyPrefs(p));
    expect(back.assist.greet.night).toBe(true);
    expect(back.assist.inactivity).toBe(false);
  });
});

describe("1141 notification centre categories", () => {
  test("the six tabs the spec asks for, in order", () => {
    expect(CENTRE_TABS.map((t) => t.title)).toEqual(["All", "Comments and Messages", "Publishing", "Performance", "Growth", "Account Alerts"]);
  });

  test("no kind lands in two tabs, and the ones creators see every day have a home", () => {
    const seen = new Set<string>();
    for (const t of CENTRE_TABS)
      for (const k of t.kinds) {
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
    for (const k of ["new_comment", "post_live", "milestone", "greet", "payment_failed"]) expect(centreTabOf(k)).not.toBe("all");
  });

  test("All has no list of its own: it means everything", () => {
    expect(centreKinds("all")).toEqual([]);
    expect(centreTabOf("made_up_kind")).toBe("all");
  });
});

describe("1141 admin config", () => {
  test("rubbish in gives the defaults back", () => {
    expect(mergeNotifyConfig(null)).toEqual(NOTIFY_CONFIG_DEFAULT);
    expect(mergeNotifyConfig("nope")).toEqual(NOTIFY_CONFIG_DEFAULT);
    expect(mergeNotifyConfig({ cooldown: { engagement: "soon" } }).cooldown.engagement).toBe(COOLDOWN_MIN.engagement);
  });

  test("an inactivity step can be moved but never to nothing", () => {
    expect(mergeNotifyConfig({ idle: { m30: { minutes: 0 } } }).idle.m30.minutes).toBe(5);
    expect(mergeNotifyConfig({ idle: { m30: { minutes: 45, title: "Back soon?" } } }).idle.m30.title).toBe("Back soon?");
  });

  test("an empty greeting list keeps the lines we have, so no slot can go blank", () => {
    expect(mergeNotifyConfig({ greet: { morning: { lines: [] } } }).greet.morning.lines).toEqual(NOTIFY_CONFIG_DEFAULT.greet.morning.lines);
    expect(mergeNotifyConfig({ greet: { morning: { lines: ["Hi {name}."] } } }).greet.morning.lines).toEqual(["Hi {name}."]);
  });

  test("no templates carry emoji or a dash for punctuation", () => {
    const text = JSON.stringify(NOTIFY_CONFIG_DEFAULT);
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });

  test("what is saved is what is read back, and the cache is dropped on save", async () => {
    await saveNotifyConfig({ paused: true, cooldown: { engagement: 9 } });
    const cfg = await notifyConfig();
    expect(cfg.paused).toBe(true);
    expect(cfg.cooldown.engagement).toBe(9);
    await saveNotifyConfig(NOTIFY_CONFIG_DEFAULT);
    expect((await notifyConfig()).paused).toBe(false);
  });
});

describe("1141 event queue", () => {
  test("the same event twice is recorded once", async () => {
    const u = await mkUser();
    const key = `cm:${uniq()}`;
    const a = await recordEvent({ userId: u.id, kind: "new_comment", source: "webhook:meta", idemKey: key, payload: { title: "A", body: "B", key } });
    const b = await recordEvent({ userId: u.id, kind: "new_comment", source: "webhook:meta", idemKey: key, payload: { title: "A", body: "B", key } });
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.id).toBe(a.id);
    expect(await db.notifyEvent.count({ where: { idemKey: key } })).toBe(1);
  });

  test("a batch reports how many were new", async () => {
    const u = await mkUser();
    const k1 = `b1:${uniq()}`;
    const k2 = `b2:${uniq()}`;
    const one = { userId: u.id, kind: "new_comment" as const, source: "webhook:meta", idemKey: k1, payload: { title: "A", body: "B", key: k1 } };
    const r = await recordEvents([one, one, { ...one, idemKey: k2, payload: { title: "C", body: "D", key: k2 } }]);
    expect(r).toEqual({ total: 3, fresh: 2 });
  });

  test("urgent events are drained before nudges", async () => {
    const u = await mkUser();
    const order: string[] = [];
    registerHandler("probe_low", async (ev) => (order.push(`low:${ev.id}`), { ok: true }));
    registerHandler("probe_high", async (ev) => (order.push(`high:${ev.id}`), { ok: true }));
    await recordEvent({ userId: u.id, kind: "probe_low" as any, source: "test", idemKey: `low:${uniq()}`, priority: 4, payload: {} });
    await recordEvent({ userId: u.id, kind: "probe_high" as any, source: "test", idemKey: `high:${uniq()}`, priority: 1, payload: {} });
    await drainEvents(new Date());
    expect(order[0].startsWith("high:")).toBe(true);
  });

  test("an event becomes a notice, once, and the notice points back at the event", async () => {
    const u = await mkUser();
    const key = `cm:${uniq()}`;
    await recordEvent({
      userId: u.id,
      kind: "new_comment",
      source: "webhook:meta",
      idemKey: key,
      payload: { title: "Priya commented", body: "Loved this", href: "/inbox", key, tone: "info" },
    });
    const r = await drainEvents(new Date());
    expect(r.done).toBeGreaterThan(0);
    const notice = await db.notice.findUnique({ where: { key } });
    expect(notice?.title).toBe("Priya commented");
    expect(await db.notifyEvent.findFirst({ where: { idemKey: key }, select: { status: true } })).toEqual({ status: "done" });
    const log = await db.notifyDelivery.findMany({ where: { userId: u.id, kind: "new_comment" } });
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].category).toBe("messages");
  });

  test("a payload with nothing to show goes straight to the dead letters", async () => {
    const u = await mkUser();
    const key = `bad:${uniq()}`;
    await recordEvent({ userId: u.id, kind: "new_comment", source: "webhook:meta", idemKey: key, payload: { nothing: true } });
    await drainEvents(new Date());
    expect(await db.notifyDeadLetter.count({ where: { idemKey: key } })).toBe(1);
    expect((await db.notifyEvent.findFirst({ where: { idemKey: key } }))?.status).toBe("dead");
  });

  test("a handler that throws is retried with backoff, then dead-lettered", async () => {
    const u = await mkUser();
    let calls = 0;
    registerHandler("probe_throw" as any, async () => {
      calls++;
      throw new Error("push service is down");
    });
    const key = `throw:${uniq()}`;
    const { id } = await recordEvent({ userId: u.id, kind: "probe_throw" as any, source: "test", idemKey: key, payload: {} });
    const now = new Date();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const ev = await db.notifyEvent.findUniqueOrThrow({ where: { id: id! } });
      await processEvent(ev as any, now);
    }
    expect(calls).toBe(MAX_ATTEMPTS);
    const row = await db.notifyEvent.findUniqueOrThrow({ where: { id: id! } });
    expect(row.status).toBe("dead");
    expect(row.lastError).toContain("push service is down");
    const dead = await db.notifyDeadLetter.findFirstOrThrow({ where: { idemKey: key } });
    expect(dead.attempts).toBe(MAX_ATTEMPTS);
  });

  test("a retry is held back, not run again in the same minute", async () => {
    const u = await mkUser();
    registerHandler("probe_retry" as any, async () => {
      throw new Error("later");
    });
    const key = `retry:${uniq()}`;
    const { id } = await recordEvent({ userId: u.id, kind: "probe_retry" as any, source: "test", idemKey: key, payload: {} });
    const now = new Date();
    await processEvent((await db.notifyEvent.findUniqueOrThrow({ where: { id: id! } })) as any, now);
    const row = await db.notifyEvent.findUniqueOrThrow({ where: { id: id! } });
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.nextAt.getTime()).toBeGreaterThan(now.getTime());
    expect((await drainEvents(now)).picked).toBe(0);
  });

  test("finished events are tidied away and the dead letters are kept", async () => {
    const u = await mkUser();
    const key = `old:${uniq()}`;
    await db.notifyEvent.create({ data: { userId: u.id, kind: "new_comment", source: "test", idemKey: key, payload: "{}", status: "done", processedAt: new Date(Date.now() - 40 * 864e5) } });
    const deadBefore = await db.notifyDeadLetter.count();
    expect(await pruneEvents(new Date())).toBeGreaterThan(0);
    expect(await db.notifyEvent.count({ where: { idemKey: key } })).toBe(0);
    expect(await db.notifyDeadLetter.count()).toBe(deadBefore);
  });
});

describe("1141 delivery log", () => {
  test("a switched-off event is recorded as a skip with its reason", () => {
    const rows = plannedRows(decide(applyPatch(NOTIFY_DEFAULTS, { ev: { post_live: false } }), "post_live", new Date(), TZ));
    expect(rows).toEqual([{ channel: "inapp", status: "skipped", reason: "event_off" }]);
  });

  test("quiet hours are recorded against the push, not the bell", () => {
    const p = applyPatch(NOTIFY_DEFAULTS, { quiet: { on: true, start: "00:00", end: "23:59", urgent: false } });
    const rows = plannedRows(decide(p, "new_comment", new Date("2026-11-05T05:00:00Z"), TZ));
    expect(rows.find((r) => r.channel === "inapp")?.status).toBe("sent");
    expect(rows.find((r) => r.channel === "push")?.reason).toBe("quiet_hours");
  });

  test("the log never throws and counts what it wrote", async () => {
    const u = await mkUser();
    expect(await logDeliveries(u.id, "new_comment", [])).toBe(0);
    expect(await logDeliveries(u.id, "new_comment", [{ channel: "push", status: "sent" }])).toBe(1);
    expect(await logDeliveries("nobody-at-all", "new_comment", [{ channel: "push", status: "sent" }])).toBe(0);
  });

  test("a held-back push leaves a row the admin can count", async () => {
    const u = await mkUser();
    await notify(u.id, { kind: "new_comment", tone: "info", title: "One", body: "B", key: `c1:${uniq()}` });
    await notify(u.id, { kind: "new_comment", tone: "info", title: "Two", body: "B", key: `c2:${uniq()}` });
    const held = await db.notifyDelivery.findMany({ where: { userId: u.id, channel: "push", status: "skipped" } });
    expect(held.some((r) => r.reason === "cooldown" || r.reason === "no_device")).toBe(true);
    const stats = await deliveryStats(1);
    expect(Object.keys(stats).length).toBeGreaterThan(0);
  });

  test("detail is kept short enough to store", async () => {
    const u = await mkUser();
    await logDeliveries(u.id, "new_comment", [{ channel: "push", status: "failed", detail: "x".repeat(2000) }]);
    const row = await db.notifyDelivery.findFirstOrThrow({ where: { userId: u.id, status: "failed" } });
    expect(row.detail!.length).toBe(500);
  });
});

describe("1141 greetings", () => {
  test("a slot is due in the first few minutes of its hour and nowhere else", () => {
    expect(dueSlot(GREET_HOUR.morning, 0)).toBe("morning");
    expect(dueSlot(GREET_HOUR.evening, 9)).toBe("evening");
    expect(dueSlot(GREET_HOUR.evening, 10)).toBeNull();
    expect(dueSlot(11, 0)).toBeNull();
  });

  test("the same creator and day always get the same line", () => {
    const lines = ["Good morning, {name}.", "Morning, {name}.", "Hello {name}."];
    const a = pickLine(lines, "u1:2026-11-05:morning", "Nina");
    expect(a).toBe(pickLine(lines, "u1:2026-11-05:morning", "Nina"));
    expect(a).toContain("Nina");
    expect(a).not.toContain("{name}");
    expect(pickLine([], "u1", "Nina")).toBe("");
  });

  test("the key allows one greeting per slot per day", () => {
    expect(assistKey.greet("u1", "2026-11-05", "morning")).toBe("greet:u1:2026-11-05:morning");
    expect(assistKey.greet("u1", "2026-11-05", "evening")).not.toBe(assistKey.greet("u1", "2026-11-05", "morning"));
  });

  test("the line under the greeting is read from the creator's own posts", async () => {
    const u = await mkUser();
    expect(await greetBody(u.id, new Date())).toContain("Nothing is scheduled");
    const media = await db.media.create({ data: { userId: u.id, originalFilename: "clip.mp4", storageKey: `k-${uniq()}`, mimeType: "video/mp4", size: 1, status: "ready" } });
    await db.post.create({ data: { userId: u.id, mediaId: media.id, status: "draft" } });
    expect(await greetBody(u.id, new Date())).toContain("1 draft is waiting");
    await db.post.create({ data: { userId: u.id, mediaId: media.id, status: "scheduled", scheduledAt: new Date(Date.now() + 36e5) } });
    expect(await greetBody(u.id, new Date())).toBe("You have 1 post going out in the next day.");
  });

  test("the sweep greets only at the slot's own hour, only once, and only if the slot is on", async () => {
    const u = await mkUser({ timezone: "UTC", lastActiveAt: new Date() });
    const at8 = new Date("2026-11-05T08:02:00Z");
    const only = [{ id: u.id, name: u.name, timezone: "UTC", notifyPrefs: u.notifyPrefs, lastActiveAt: u.lastActiveAt, lastSeenAt: u.lastSeenAt }];
    expect((await sweepGreetings(new Date("2026-11-05T11:00:00Z"), only)).sent).toBe(0);
    expect((await sweepGreetings(at8, only)).sent).toBe(1);
    expect((await sweepGreetings(at8, only)).sent).toBe(0);
    await drainEvents(at8);
    const notice = await db.notice.findUniqueOrThrow({ where: { key: assistKey.greet(u.id, "2026-11-05", "morning") } });
    expect(notice.kind).toBe("greet");
    expect(notice.title).toContain("Nina");
  });

  test("a creator who turned that slot off is not greeted", async () => {
    const u = await mkUser({ timezone: "UTC", lastActiveAt: new Date(), notifyPrefs: serializeNotifyPrefs(applyPatch(NOTIFY_DEFAULTS, { assist: { greet: { morning: false } } })) });
    const only = [{ id: u.id, name: u.name, timezone: "UTC", notifyPrefs: u.notifyPrefs, lastActiveAt: u.lastActiveAt, lastSeenAt: u.lastSeenAt }];
    expect((await sweepGreetings(new Date("2026-11-05T08:02:00Z"), only)).sent).toBe(0);
  });

  test("a slot the admin switched off greets nobody", async () => {
    const u = await mkUser({ timezone: "UTC", lastActiveAt: new Date() });
    const only = [{ id: u.id, name: u.name, timezone: "UTC", notifyPrefs: u.notifyPrefs, lastActiveAt: u.lastActiveAt, lastSeenAt: u.lastSeenAt }];
    await saveNotifyConfig({ ...NOTIFY_CONFIG_DEFAULT, greet: { ...NOTIFY_CONFIG_DEFAULT.greet, morning: { on: false, lines: NOTIFY_CONFIG_DEFAULT.greet.morning.lines } } });
    expect((await sweepGreetings(new Date("2026-11-05T08:02:00Z"), only)).sent).toBe(0);
    await saveNotifyConfig(NOTIFY_CONFIG_DEFAULT);
  });

  test("an empty line list sends nothing rather than an empty notification", async () => {
    const u = await mkUser();
    expect((await recordGreeting(u, "morning", "2026-11-05", [], new Date())).id).toBeNull();
  });
});

describe("1141 inactivity steps", () => {
  const idle = NOTIFY_CONFIG_DEFAULT.idle;

  test("the four steps the spec asks for", () => {
    expect(IDLE_TIERS).toEqual(["m30", "h24", "d3", "d7"]);
    expect([idle.m30.minutes, idle.h24.minutes, idle.d3.minutes, idle.d7.minutes]).toEqual([30, 1440, 4320, 10080]);
  });

  test("only the furthest step that applies, so somebody back after a month hears one thing", () => {
    expect(dueIdleTier(10, idle)).toBeNull();
    expect(dueIdleTier(31, idle)).toBe("m30");
    expect(dueIdleTier(60 * 25, idle)).toBe("h24");
    expect(dueIdleTier(60 * 24 * 30, idle)).toBe("d7");
  });

  test("a step switched off is skipped, not replaced by the step below", () => {
    const off = { ...idle, d7: { ...idle.d7, on: false } };
    expect(dueIdleTier(60 * 24 * 30, off)).toBe("d3");
    expect(dueIdleTier(31, { ...idle, m30: { ...idle.m30, on: false } })).toBeNull();
  });

  test("never here at all is not the same as away for a while", () => {
    expect(minutesAway(null, new Date())).toBe(Number.POSITIVE_INFINITY);
    expect(minutesAway(new Date(Date.now() - 60_000), new Date())).toBe(1);
  });

  test("a new spell away arms the steps again", () => {
    const first = new Date("2026-11-01T00:00:00Z");
    const second = new Date("2026-11-04T00:00:00Z");
    expect(assistKey.idle("u1", "m30", first)).not.toBe(assistKey.idle("u1", "m30", second));
    expect(assistKey.idle("u1", "m30", first)).toBe(assistKey.idle("u1", "m30", first));
  });

  test("the sweep nudges once per step and the event becomes a notice", async () => {
    const seen = new Date("2026-11-05T09:00:00Z");
    const u = await mkUser({ timezone: "UTC", lastActiveAt: seen });
    const only = [{ id: u.id, name: u.name, timezone: "UTC", notifyPrefs: u.notifyPrefs, lastActiveAt: seen, lastSeenAt: null }];
    const at = new Date("2026-11-05T09:40:00Z");
    expect((await sweepInactivity(new Date("2026-11-05T09:10:00Z"), only)).sent).toBe(0);
    expect((await sweepInactivity(at, only)).sent).toBe(1);
    expect((await sweepInactivity(at, only)).sent).toBe(0);
    await drainEvents(at);
    const notice = await db.notice.findUniqueOrThrow({ where: { key: assistKey.idle(u.id, "m30", seen) } });
    expect(notice.kind).toBe("inactivity");
    expect(notice.href).toBe("/create");
  });

  test("somebody gone for good is left alone", async () => {
    const seen = new Date(Date.now() - 60 * 864e5);
    const u = await mkUser({ timezone: "UTC", lastActiveAt: seen });
    const only = [{ id: u.id, name: u.name, timezone: "UTC", notifyPrefs: u.notifyPrefs, lastActiveAt: seen, lastSeenAt: null }];
    expect((await sweepInactivity(new Date(), only)).sent).toBe(0);
  });

  test("a creator who switched the nudges off is left alone", async () => {
    const seen = new Date(Date.now() - 40 * 60_000);
    const u = await mkUser({ timezone: "UTC", lastActiveAt: seen, notifyPrefs: serializeNotifyPrefs(applyPatch(NOTIFY_DEFAULTS, { assist: { inactivity: false } })) });
    const only = [{ id: u.id, name: u.name, timezone: "UTC", notifyPrefs: u.notifyPrefs, lastActiveAt: seen, lastSeenAt: null }];
    expect((await sweepInactivity(new Date(), only)).sent).toBe(0);
  });
});

describe("1141 summaries", () => {
  test("one summary per window, however often the sweep runs", () => {
    const w = 30;
    expect(digestSlot(new Date("2026-11-05T10:01:00Z"), w)).toBe(digestSlot(new Date("2026-11-05T10:29:00Z"), w));
    expect(digestSlot(new Date("2026-11-05T10:01:00Z"), w)).not.toBe(digestSlot(new Date("2026-11-05T10:31:00Z"), w));
  });

  test("a quiet window sends nothing", async () => {
    const u = await mkUser();
    await logDeliveries(u.id, "new_comment", [{ channel: "push", status: "skipped", reason: "cooldown" }]);
    expect((await sweepDigests(new Date())).sent).toBe(0);
  });

  test("enough held-back pushes become one summary that counts them honestly", async () => {
    const u = await mkUser();
    const cfg = await notifyConfig();
    for (let i = 0; i < cfg.digest.min; i++) await logDeliveries(u.id, "new_comment", [{ channel: "push", status: "skipped", reason: "cooldown" }]);
    const now = new Date();
    const r = await sweepDigests(now);
    expect(r.sent).toBe(1);
    const ev = await db.notifyEvent.findFirstOrThrow({ where: { userId: u.id, kind: "summary" } });
    const payload = JSON.parse(ev.payload);
    expect(payload.title).toBe(`${cfg.digest.min} updates you have not seen`);
    expect(payload.body).toContain("comments and messages");
    expect((await sweepDigests(now)).sent).toBe(0);
  });

  test("summaries can be switched off entirely", async () => {
    await saveNotifyConfig({ ...NOTIFY_CONFIG_DEFAULT, digest: { ...NOTIFY_CONFIG_DEFAULT.digest, on: false } });
    expect(await sweepDigests(new Date())).toEqual({ looked: 0, sent: 0 });
    await saveNotifyConfig(NOTIFY_CONFIG_DEFAULT);
  });
});
