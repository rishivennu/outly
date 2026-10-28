/**
 * 1037: Pro Multi-Account Manager. Pure rules first (profiles, delegation scope, collaboration, bulk rounds,
 * badges, reports, alerts, live counts, landing maths), then the database paths that matter: the one-time
 * plan migration, the account limit and the engagement-spike sweep.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { inScope, matchProfile, parseScope, pickAccount, postAccountWhere, postInScope, profileOnline } from "../lib/profiles-core";
import { approvalCurrent, approveBlock, copyChanged, shouldLogEdit, EDIT_NOTE_WINDOW_MS } from "../lib/collab-core";
import { accountRounds, BULK_ACCOUNTS_MAX } from "../lib/posts/bulk";
import { isVerifiedManager, MANAGER_SLUG } from "../lib/badges-core";
import { csvCell, reportCsv, reportPdf, type ClientReport } from "../lib/reports/client-report";
import { memberBlock } from "../lib/team/roles";
import { checkAccounts } from "../lib/billing/entitlements";
import { planFeatures } from "../lib/billing/money";
import { ALERT_DEFAULTS, dayStamp, parseAlertPrefs, serializeAlertPrefs, spikeLabel, spikeRatio, SPIKE_FLOOR } from "../lib/alerts-core";
import { compactCount, liveView, presenceDue, LIVE_MIN_TOTAL, PRESENCE_WRITE_MS } from "../lib/presence-core";
import { floorNice, trustFigures } from "../lib/marketing/trust-core";
import { OUTLLY_MIN_PER_VIDEO, TIME_DEFAULTS, minutesLabel, savedFromPosts, timeSaved } from "../lib/marketing/time-saved";
import { LANDING_DEFAULT, LANDING_SECTIONS, shown } from "../lib/landing";

describe("profiles and delegation scope", () => {
  test("parseScope: empty = every account, a damaged value fails closed", () => {
    expect(parseScope(null)).toBeNull();
    expect(parseScope("")).toBeNull();
    expect(parseScope('["a","b","a"]')).toEqual(["a", "b"]);
    expect(parseScope("{not json")).toEqual([]);
    expect(parseScope('{"a":1}')).toEqual([]);
    expect(parseScope('"a"')).toEqual([]);
    expect(parseScope(JSON.stringify([1, "", "x".repeat(41), "ok"]))).toEqual(["ok"]);
  });
  test("inScope / postInScope", () => {
    expect(inScope(null, "a")).toBe(true);
    expect(inScope(["a"], "a")).toBe(true);
    expect(inScope(["a"], "b")).toBe(false);
    expect(inScope(["a"], null)).toBe(false);
    expect(postInScope([{ socialAccountId: "a" }, { socialAccountId: null }], ["a"])).toBe(true);
    expect(postInScope([{ socialAccountId: "a" }, { socialAccountId: "b" }], ["a"])).toBe(false);
  });
  test("postAccountWhere: owner sees all, a picked profile narrows, the default account keeps unpinned posts", () => {
    expect(postAccountWhere(null, null)).toEqual({});
    expect(postAccountWhere("a", null)).toEqual({ targets: { some: { socialAccountId: "a" } } });
    expect(postAccountWhere("a", null, "instagram")).toEqual({ targets: { some: { OR: [{ socialAccountId: "a" }, { socialAccountId: null, platform: "instagram" }] } } });
    expect(postAccountWhere(null, ["a", "b"])).toEqual({ targets: { some: { socialAccountId: { in: ["a", "b"] } }, none: { socialAccountId: { notIn: ["a", "b"] } } } });
  });
  const A = (id: string, platform: string, created: string, status = "connected") => ({ id, platform, username: id, displayName: null, status, createdAt: created });
  test("pickAccount: pin, then active profile, then oldest connected in scope", () => {
    const accts = [A("ig2", "instagram", "2026-02-01"), A("ig1", "instagram", "2026-01-01"), A("yt", "youtube", "2026-01-01")];
    expect(pickAccount("instagram", null, accts, null)?.id).toBe("ig1");
    expect(pickAccount("instagram", null, accts, null, "ig2")?.id).toBe("ig2");
    expect(pickAccount("instagram", "ig2", accts, null, "ig1")?.id).toBe("ig2");
    expect(pickAccount("instagram", "ig2", accts, ["ig1"])).toBeNull(); // pinned outside scope never falls back silently
    expect(pickAccount("instagram", null, accts, ["ig2"])?.id).toBe("ig2");
    expect(pickAccount("x", null, accts, null)).toBeNull();
  });
  test("matchProfile and profileOnline", () => {
    expect(matchProfile({ username: "@maya", displayName: "Maya K", platform: "instagram" }, "@MAY")).toBe(true);
    expect(matchProfile({ username: "@maya", displayName: null, platform: "instagram" }, "insta")).toBe(true);
    expect(matchProfile({ username: "@maya", displayName: null, platform: "instagram" }, "zed")).toBe(false);
    const now = Date.parse("2026-10-28T00:00:00Z");
    expect(profileOnline({ status: "connected" }, now)).toBe(true);
    expect(profileOnline({ status: "needs_reconnect" }, now)).toBe(false);
    expect(profileOnline({ status: "connected", tokenExpiresAt: "2026-10-27T00:00:00Z" }, now)).toBe(false);
    expect(profileOnline({ status: "connected", tokenExpiresAt: "2026-10-27T00:00:00Z", refreshToken: "r" }, now)).toBe(true);
  });
});

describe("draft collaboration", () => {
  const before = { title: "T", story: null, hook: "h", mediaId: "m", targets: [{ platform: "x", caption: "hi" }] };
  test("only a real change counts as an edit", () => {
    expect(copyChanged(before, { title: " T ", targets: [{ platform: "x", caption: "hi" }] })).toBe(false);
    expect(copyChanged(before, { targets: [{ platform: "x", caption: "hello" }] })).toBe(true);
    expect(copyChanged(before, { mediaId: "m2" })).toBe(true);
    expect(copyChanged(before, { targets: [{ platform: "x" }, { platform: "youtube" }] }, { replaceTargets: true })).toBe(true);
  });
  test("an approval older than the last edit doesn't count", () => {
    const r = [{ status: "approved", decidedAt: "2026-10-28T10:00:00Z" }];
    expect(approvalCurrent(r, null)).toBe(true);
    expect(approvalCurrent(r, "2026-10-28T09:00:00Z")).toBe(true);
    expect(approvalCurrent(r, "2026-10-28T11:00:00Z")).toBe(false);
  });
  test("who may approve: owner yes, editor never, manager not their own change", () => {
    expect(approveBlock("owner", "o", "o")).toBeNull();
    expect(approveBlock("editor", "e", null)).toMatch(/Editors/);
    expect(approveBlock("manager", "m", "m")).toMatch(/someone else/);
    expect(approveBlock("manager", "m", "e")).toBeNull();
    expect(memberBlock("editor", "POST", "/api/posts/p1/approve")).toMatch(/Editors can't approve/);
    expect(memberBlock("manager", "POST", "/api/posts/p1/approve")).toBeNull();
    expect(memberBlock("editor", "POST", "/api/posts/p1/notes")).toBeNull(); // editors can comment
  });
  test("members can't reach accounts, team access or the owner's alerts", () => {
    expect(memberBlock("manager", "DELETE", "/api/accounts/instagram")).toMatch(/owner/);
    expect(memberBlock("manager", "PATCH", "/api/team/members/x")).toMatch(/owner/);
    expect(memberBlock("manager", "PATCH", "/api/settings/alerts")).toMatch(/owner/);
  });
  test("autosave logs one edit line per person per window", () => {
    const now = Date.parse("2026-10-28T10:00:00Z");
    const last = { kind: "edit", authorId: "a", createdAt: new Date(now - 60_000) };
    expect(shouldLogEdit(null, "a", now)).toBe(true);
    expect(shouldLogEdit(last, "a", now)).toBe(false);
    expect(shouldLogEdit(last, "b", now)).toBe(true);
    expect(shouldLogEdit({ ...last, createdAt: new Date(now - EDIT_NOTE_WINDOW_MS - 1) }, "a", now)).toBe(true);
  });
});

describe("bulk across accounts", () => {
  test("rounds hold one account per platform, in order, without duplicates", () => {
    const a = (id: string, platform: string) => ({ id, platform });
    const r = accountRounds([a("ig1", "instagram"), a("yt1", "youtube"), a("ig2", "instagram"), a("ig1", "instagram"), a("ig3", "instagram")]);
    expect(r.map((x) => x.map((y) => y.id))).toEqual([["ig1", "yt1"], ["ig2"], ["ig3"]]);
    expect(accountRounds([])).toEqual([]);
    expect(BULK_ACCOUNTS_MAX).toBe(10);
  });
});

describe("plan limits and badges", () => {
  test("checkAccounts: 0 = one per platform, otherwise a total cap", () => {
    expect(() => checkAccounts({ accountLimit: 0, planName: "Free" }, 99)).not.toThrow();
    expect(() => checkAccounts({ accountLimit: 10, planName: "Pro" }, 9)).not.toThrow();
    expect(() => checkAccounts({ accountLimit: 10, planName: "Pro" }, 10)).toThrow(/10 connected accounts/);
  });
  test("Verified Manager: the plan, a proven email and two or more accounts", () => {
    expect(isVerifiedManager({ planSlug: MANAGER_SLUG, proven: true, accounts: 2 })).toBe(true);
    expect(isVerifiedManager({ planSlug: MANAGER_SLUG, proven: false, accounts: 5 })).toBe(false);
    expect(isVerifiedManager({ planSlug: MANAGER_SLUG, proven: true, accounts: 1 })).toBe(false);
    expect(isVerifiedManager({ planSlug: "studio", proven: true, accounts: 5 })).toBe(false);
  });
  test("plan cards always state the real account limit", () => {
    expect(planFeatures({ features: ["Everything in Studio", "Up to 8 connected accounts", "Reports"], accountLimit: 10 })).toEqual(["Everything in Studio", "Up to 10 connected accounts", "Reports"]);
    expect(planFeatures({ features: ["Reports"], accountLimit: 5 })).toEqual(["Up to 5 connected accounts", "Reports"]);
    expect(planFeatures({ features: ["Reports"], accountLimit: 0 })).toEqual(["Reports"]);
  });
});

describe("client reports", () => {
  test("csvCell quotes and defuses formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=HYPERLINK(1)").startsWith("'=") || csvCell("=HYPERLINK(1)").startsWith("\"'=")).toBe(true);
    expect(csvCell("@cmd")).toContain("'@");
    expect(csvCell(null)).toBe("");
    expect(csvCell(12)).toBe("12");
  });
  const r: ClientReport = {
    workspace: "Maya's studio", scope: "All accounts", rangeDays: 30, from: "2026-09-28T00:00:00Z", to: "2026-10-28T00:00:00Z", generatedAt: "2026-10-28T00:00:00Z", tz: "Asia/Kolkata",
    totals: { views: 1200, likes: 80, comments: 10, shares: 5, engagement: 7.9 }, previousViews: 900,
    byPlatform: [{ platform: "instagram", views: 1200, engagement: 7.9 }],
    byAccount: [{ platform: "instagram", username: "@maya", views: 1200, engagement: 7.9, posts: 3 }],
    daily: [{ date: "2026-10-27", views: 40 }],
    posts: [{ title: "=evil()", platform: "instagram", account: "@maya", publishedAt: "2026-10-20T00:00:00Z", views: 400, likes: 30, comments: 2, shares: 1, url: null }],
  };
  test("CSV has the sections and no live formula", () => {
    const csv = reportCsv(r);
    expect(csv).toContain("@maya");
    expect(csv).toContain("1200");
    expect(csv).not.toMatch(/(^|,)=evil/m);
  });
  test("PDF is a real PDF", () => {
    const pdf = reportPdf(r);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(500);
  });
});

describe("custom alerts", () => {
  test("prefs: defaults on missing or broken, clamped values", () => {
    expect(parseAlertPrefs(null)).toEqual(ALERT_DEFAULTS);
    expect(parseAlertPrefs("nope")).toEqual(ALERT_DEFAULTS);
    expect(parseAlertPrefs("[1]")).toEqual(ALERT_DEFAULTS);
    expect(parseAlertPrefs('{"failed":false,"spikeX":99}')).toEqual({ ...ALERT_DEFAULTS, failed: false, spikeX: 10 });
    expect(parseAlertPrefs('{"spikeX":"3"}').spikeX).toBe(ALERT_DEFAULTS.spikeX);
    expect(parseAlertPrefs(serializeAlertPrefs({ spike: false, spikeX: 3, failed: true, email: true }))).toEqual({ spike: false, spikeX: 3, failed: true, email: true });
  });
  test("spikeRatio: above the floor and the multiple, against the 7-day daily average", () => {
    expect(spikeRatio(SPIKE_FLOOR - 1, 0, 2)).toBeNull();
    expect(spikeRatio(300, 700, 2)).toBe(3); // usual day 100
    expect(spikeRatio(150, 700, 2)).toBeNull();
    expect(spikeRatio(500, 0, 2)).toBe(Infinity);
    expect(spikeLabel(3)).toBe("3x your usual day");
    expect(spikeLabel(12.4)).toBe("12x your usual day");
    expect(spikeLabel(Infinity)).toMatch(/well above/);
  });
  test("dayStamp follows the owner's zone", () => {
    const t = new Date("2026-10-28T20:00:00Z");
    expect(dayStamp(t, "Asia/Kolkata")).toBe("2026-10-29");
    expect(dayStamp(t, "UTC")).toBe("2026-10-28");
    expect(dayStamp(t, "Not/AZone")).toBe("2026-10-28");
  });
});

describe("live counts and landing", () => {
  test("real counts from the first creator, never padded, never '0 online' (1038)", () => {
    expect(liveView(null)).toEqual({ total: null, online: null });
    expect(liveView({ total: LIVE_MIN_TOTAL - 1, online: 5 })).toEqual({ total: null, online: null });
    expect(liveView({ total: 3, online: 0 })).toEqual({ total: 3, online: null });
    expect(liveView({ total: 3, online: 1 })).toEqual({ total: 3, online: 1 });
    expect(liveView({ total: 3, online: 9 })).toEqual({ total: 3, online: 3 }); // online never exceeds total
    expect(liveView({ total: 40, online: 7 })).toEqual({ total: 40, online: 7 });
    expect(presenceDue(undefined, 0)).toBe(true);
    expect(presenceDue(1000, 1000 + PRESENCE_WRITE_MS - 1)).toBe(false);
    expect(presenceDue(1000, 1000 + PRESENCE_WRITE_MS)).toBe(true);
    expect(compactCount(999)).toBe("999");
    expect(compactCount(1250)).toBe("1.2k");
    expect(compactCount(12_600)).toBe("13k");
  });
  test("trust figures round down and only hide at zero (1038)", () => {
    expect(floorNice(1249)).toBe(1200);
    expect(floorNice(99)).toBe(99);
    expect(trustFigures({ creators: 0, posts: 0, platforms: 3 })).toEqual([{ value: "3", label: "platforms live today" }]);
    expect(trustFigures({ creators: 10, posts: 20, platforms: 3 }).map((f) => f.value)).toEqual(["10+", "20+", "3"]);
    expect(trustFigures({ creators: 1249, posts: 130, platforms: 0 }).map((f) => f.value)).toEqual(["1,200+", "130+"]);
  });
  test("time saved is the visitor's own maths", () => {
    expect(timeSaved({ videos: 5, platforms: 3, byHand: 12 })).toEqual({ manualWeek: 180, outllyWeek: 20, savedWeek: 160, savedMonthHours: 11.6 });
    expect(timeSaved({ videos: 1, platforms: 1, byHand: 3 }).savedWeek).toBe(0); // never negative
    expect(minutesLabel(160)).toBe("2 h 40 min");
    expect(minutesLabel(45)).toBe("45 min");
    expect(minutesLabel(120)).toBe("2 h");
  });
  test("Home time saved counts each real post once per platform it reached (1038)", () => {
    expect(savedFromPosts([])).toBe(0);
    expect(savedFromPosts([3])).toBe(3 * TIME_DEFAULTS.byHand - OUTLLY_MIN_PER_VIDEO);
    expect(savedFromPosts([1, 2, 3])).toBe(savedFromPosts([1]) + savedFromPosts([2]) + savedFromPosts([3]));
    expect(savedFromPosts([0, -2])).toBe(0); // never negative
    expect(savedFromPosts([1], 3)).toBe(0);
  });
  test("new landing sections are switchable and on by default", () => {
    for (const id of ["time", "trust"] as const) {
      expect(LANDING_SECTIONS.some((s) => s.id === id)).toBe(true);
      expect(shown(LANDING_DEFAULT, id)).toBe(true);
    }
  });
});

describe("database", () => {
  let db: typeof import("../lib/db").db;
  let encrypt: typeof import("../lib/crypto").encrypt;
  beforeAll(async () => {
    ({ db } = await import("../lib/db"));
    ({ encrypt } = await import("../lib/crypto"));
  }, 60_000);

  test("the Pro Manager plan is added once and an admin's edits survive", async () => {
    const plans = await import("../lib/billing/plans");
    await plans.ensurePlans();
    await plans.ensurePlans();
    expect(await db.plan.count({ where: { slug: "pro-manager" } })).toBe(1);
    const p = await db.plan.findUnique({ where: { slug: "pro-manager" } });
    expect(p?.accountLimit).toBe(10);
    await db.plan.update({ where: { slug: "pro-manager" }, data: { name: "Agency" } });
    await plans.ensurePlans();
    expect((await db.plan.findUnique({ where: { slug: "pro-manager" } }))?.name).toBe("Agency");
    await db.plan.update({ where: { slug: "pro-manager" }, data: { name: plans.PRO_MANAGER.name } });
  });

  test("1038 rename: an untouched 1037 row becomes Pro, an admin's edits are kept", async () => {
    const plans = await import("../lib/billing/plans");
    await plans.ensurePlans();
    const old = { name: "Pro Multi-Account Manager", note: "For managers running 5 or more accounts", features: JSON.stringify(["Everything in Studio", "Up to 10 connected accounts", "Switch profiles in one tap", "Bulk schedule across accounts", "Per-account team access", "Combined analytics with drilldown", "PDF and CSV client reports", "Spike and failed-post alerts"]) };
    const keep = { name: "Pro", note: "My own note", features: "[]" };
    try {
      await db.plan.update({ where: { slug: "pro-manager" }, data: { name: old.name, note: keep.note, features: old.features } });
      await db.setting.deleteMany({ where: { key: "migrate:pro-rename-1038" } });
      await plans.ensurePlans();
      const p = await db.plan.findUnique({ where: { slug: "pro-manager" } });
      expect(p?.name).toBe("Pro");
      expect(p?.note).toBe(keep.note); // edited by an admin: left alone
      expect(JSON.parse(p!.features)).toEqual(plans.PRO_MANAGER.features);
      expect(plans.PRO_MANAGER.features.length).toBeLessThanOrEqual(5);
      await db.plan.update({ where: { slug: "pro-manager" }, data: { name: "Agency" } });
      await plans.ensurePlans(); // runs once only
      expect((await db.plan.findUnique({ where: { slug: "pro-manager" } }))?.name).toBe("Agency");
    } finally {
      await db.plan.update({ where: { slug: "pro-manager" }, data: { name: plans.PRO_MANAGER.name, note: plans.PRO_MANAGER.note, features: JSON.stringify(plans.PRO_MANAGER.features) } });
    }
  });

  test("time saved on Home: own published posts only, week counts this week's platforms, scope narrows it", async () => {
    const { savedTime } = await import("../lib/retention/time-saved");
    const s = `${Date.now()}`;
    const user = await db.user.create({ data: { name: "Saved", email: `saved-${s}@test.dev`, passwordHash: "x" } });
    const other = await db.user.create({ data: { name: "Other", email: `saved-o-${s}@test.dev`, passwordHash: "x" } });
    const media = await db.media.create({ data: { userId: user.id, originalFilename: "a.mp4", storageKey: `saved/${s}.mp4`, mimeType: "video/mp4", size: 10, status: "ready" } });
    const acct = (u: string, n: number, platform: string) => db.socialAccount.create({ data: { userId: u, platform, platformUserId: `saved-${s}-${n}`, username: `@v${n}`, accessToken: encrypt("t"), status: "connected" } });
    const [a, b, o] = [await acct(user.id, 1, "instagram"), await acct(user.id, 2, "youtube"), await acct(other.id, 3, "instagram")];
    const now = Date.now();
    const ago = (d: number) => new Date(now - d * 86_400_000);
    const post = (u: string) => db.post.create({ data: { userId: u, mediaId: media.id, status: "published", title: "T" } });
    const target = (postId: string, acc: { id: string; platform: string }, d: number, extra: { practice?: boolean; platformStatus?: string } = {}) =>
      db.postTarget.create({ data: { postId, platform: acc.platform, socialAccountId: acc.id, platformStatus: extra.platformStatus ?? "published", practice: extra.practice ?? false, publishedAt: ago(d) } });
    const p1 = await post(user.id); // A this week, B long ago: the week counts only A
    await target(p1.id, a, 1);
    await target(p1.id, b, 20);
    const p2 = await post(user.id); // B only, this week
    await target(p2.id, b, 3);
    const p3 = await post(user.id); // practice and failed: never count
    await target(p3.id, a, 1, { practice: true });
    await target(p3.id, b, 1, { platformStatus: "failed" });
    const p4 = await post(other.id); // someone else's
    await target(p4.id, o, 1);

    const all = await savedTime(user.id, now);
    expect(all.posts).toBe(2);
    expect(all.totalMin).toBe(savedFromPosts([2, 1]));
    expect(all.weekPosts).toBe(2);
    expect(all.weekMin).toBe(savedFromPosts([1, 1]));
    // A team seat scoped to B never sees p1 (it also went to A).
    const onlyB = await savedTime(user.id, now, postAccountWhere(null, [b.id]));
    expect(onlyB.posts).toBe(1);
    expect(onlyB.totalMin).toBe(savedFromPosts([1]));
    const none = await savedTime(user.id, now, postAccountWhere(null, ["no-such-account"]));
    expect(none).toEqual({ weekMin: 0, totalMin: 0, posts: 0, weekPosts: 0 });
  });

  test("engagement spike: one alert per account per day, nothing for a normal day", async () => {
    const { sweepSpikes } = await import("../lib/retention/alerts");
    const s = `${Date.now()}`;
    const user = await db.user.create({ data: { name: "Spike", email: `spike-${s}@test.dev`, passwordHash: "x", timezone: "UTC" } });
    const media = await db.media.create({ data: { userId: user.id, originalFilename: "a.mp4", storageKey: `spike/${s}.mp4`, mimeType: "video/mp4", size: 10, status: "ready" } });
    const mkAcct = (n: number) => db.socialAccount.create({ data: { userId: user.id, platform: "instagram", platformUserId: `ig-real-${s}-${n}`, username: `@acct${n}`, accessToken: encrypt("t"), status: "connected" } });
    const hot = await mkAcct(1);
    const calm = await mkAcct(2);
    const now = new Date();
    const ago = (h: number) => new Date(now.getTime() - h * 36e5);
    for (const [acct, today] of [[hot, 900], [calm, 120]] as const) {
      const post = await db.post.create({ data: { userId: user.id, mediaId: media.id, status: "published", title: "Goa" } });
      const t = await db.postTarget.create({ data: { postId: post.id, platform: "instagram", socialAccountId: acct.id, platformStatus: "published", publishedAt: ago(200) } });
      for (let d = 2; d <= 8; d++) await db.targetMetric.create({ data: { targetId: t.id, capturedAt: ago(d * 24 - 2), views: 100 } });
      await db.targetMetric.create({ data: { targetId: t.id, capturedAt: ago(2), views: today } });
    }
    await sweepSpikes(now);
    await sweepSpikes(now);
    const notes = await db.notice.findMany({ where: { userId: user.id, kind: "engagement_spike" } });
    expect(notes).toHaveLength(1);
    expect(notes[0].key).toContain(hot.id);
    expect(notes[0].title).toContain("@acct1");
    expect(notes[0].body).toContain("9x your usual day");

    await db.user.update({ where: { id: user.id }, data: { alertPrefs: JSON.stringify({ spike: false }) } });
    await db.notice.deleteMany({ where: { userId: user.id } });
    await sweepSpikes(now);
    expect(await db.notice.count({ where: { userId: user.id } })).toBe(0);
  });

  test("failure alerts respect the owner's switch", async () => {
    const { noticeFailedTarget } = await import("../lib/retention/notices");
    const s = `${Date.now()}f`;
    const user = await db.user.create({ data: { name: "Fail", email: `fail-${s}@test.dev`, passwordHash: "x", alertPrefs: JSON.stringify({ failed: false }) } });
    const media = await db.media.create({ data: { userId: user.id, originalFilename: "a.mp4", storageKey: `fail/${s}.mp4`, mimeType: "video/mp4", size: 10, status: "ready" } });
    const post = await db.post.create({ data: { userId: user.id, mediaId: media.id, status: "failed", title: "Oops" } });
    const acct = await db.socialAccount.create({ data: { userId: user.id, platform: "x", platformUserId: `x-real-${s}`, username: "@f", accessToken: encrypt("t"), status: "connected" } });
    const t = await db.postTarget.create({ data: { postId: post.id, platform: "x", socialAccountId: acct.id, platformStatus: "failed" } });
    await noticeFailedTarget(t.id, "PLATFORM_REJECTED");
    expect(await db.notice.count({ where: { userId: user.id, kind: "post_failed" } })).toBe(0);
    await db.user.update({ where: { id: user.id }, data: { alertPrefs: null } });
    await noticeFailedTarget(t.id, "PLATFORM_REJECTED");
    expect(await db.notice.count({ where: { userId: user.id, kind: "post_failed" } })).toBe(1);
  });
  // Verifier round (1037b): member scope reaches the inboxes, review links can't clear your own change,
  // a lapsed plan never deletes accounts.
  const scopeFixture = async (tag: string) => {
    const s = `${Date.now()}${tag}`;
    const user = await db.user.create({ data: { name: "Scope", email: `scope-${s}@test.dev`, passwordHash: "x" } });
    const media = await db.media.create({ data: { userId: user.id, originalFilename: "a.mp4", storageKey: `scope/${s}.mp4`, mimeType: "video/mp4", size: 10, status: "ready" } });
    const mk = (n: number) => db.socialAccount.create({ data: { userId: user.id, platform: "instagram", platformUserId: `ig-scope-${s}-${n}`, username: `@s${n}`, accessToken: encrypt("t"), status: "connected" } });
    const mine = await mk(1);
    const theirs = await mk(2);
    const target = async (acct: { id: string }) => {
      const post = await db.post.create({ data: { userId: user.id, mediaId: media.id, status: "published", title: "Goa" } });
      return db.postTarget.create({ data: { postId: post.id, platform: "instagram", socialAccountId: acct.id, platformStatus: "published", platformPostId: `m-${acct.id}`, publishedAt: new Date() } });
    };
    return { user, media, mine, theirs, tMine: await target(mine), tTheirs: await target(theirs) };
  };

  test("comments inbox: a scoped member never sees or answers on another account", async () => {
    const inboxMod = await import("../lib/inbox");
    const f = await scopeFixture("i");
    const scope = [f.mine.id];
    const out = JSON.stringify(await inboxMod.inbox(f.user.id, undefined, scope));
    expect(out).not.toContain(f.theirs.id);
    expect(out).not.toContain(f.tTheirs.id);
    const owner = JSON.stringify(await inboxMod.inbox(f.user.id));
    expect(owner).toContain(f.tTheirs.id);
    await expect(inboxMod.replyToComment(f.user.id, f.tTheirs.id, "c1", "hi", scope)).rejects.toMatchObject({ status: 404 });
    await expect(inboxMod.replyToComment(f.user.id, inboxMod.accountTargetId(f.theirs.id, "m1"), "c1", "hi", scope)).rejects.toMatchObject({ status: 404 });
  });

  test("messages: a scoped member never sees or answers another account's conversations", async () => {
    const svc = await import("../lib/messages/service");
    const f = await scopeFixture("d");
    const thread = (acct: { id: string }) => db.dmThread.create({ data: { userId: f.user.id, accountId: acct.id, platform: "instagram", participantId: `p-${acct.id}`, lastMessageAt: new Date(), lastInboundAt: new Date() } });
    const tm = await thread(f.mine);
    const tt = await thread(f.theirs);
    const scope = [f.mine.id];
    const list = await svc.listThreads(f.user.id, undefined, scope);
    expect(list.threads.map((t) => t.id)).toEqual([tm.id]);
    expect(list.accounts).toBe(1);
    expect((await svc.listThreads(f.user.id)).threads.map((t) => t.id).sort()).toEqual([tm.id, tt.id].sort());
    await expect(svc.getThread(f.user.id, tt.id, scope)).rejects.toMatchObject({ status: 404 });
    await expect(svc.replyToThread(f.user.id, "m", tt.id, "hi", scope)).rejects.toMatchObject({ status: 404 });
    expect((await svc.getThread(f.user.id, tm.id, scope)).thread.id).toBe(tm.id);
  });

  test("a member's own review link can't clear the change they made; anyone else's can", async () => {
    const review = await import("../lib/review");
    const f = await scopeFixture("r");
    const post = await db.post.create({ data: { userId: f.user.id, mediaId: f.media.id, status: "draft", title: "Draft", requireApproval: true, editedAt: new Date(Date.now() - 1000), editedById: "member-1" } });
    const approve = async (createdById: string | null) => {
      const { token } = await review.createReviewRequest(f.user.id, post.id, createdById);
      await review.decideReview(token, { decision: "approved", reviewerName: "Me" });
    };
    await approve("member-1");
    expect(await review.isApproved(post)).toBe(false);
    expect(await review.isApproved({ id: post.id, requireApproval: true })).toBe(false);
    await approve(null);
    expect(await review.isApproved(post)).toBe(true);
  });

  test("one-account plans set the old account aside instead of deleting it", async () => {
    const { saveConnectedAccount } = await import("../lib/accounts");
    const s = `${Date.now()}c`;
    const user = await db.user.create({ data: { name: "Lapsed", email: `lapsed-${s}@test.dev`, passwordHash: "x" } });
    const old = await db.socialAccount.create({ data: { userId: user.id, platform: "youtube", platformUserId: `yt-old-${s}`, username: "old", accessToken: encrypt("t"), status: "connected" } });
    const media = await db.media.create({ data: { userId: user.id, originalFilename: "a.mp4", storageKey: `lapsed/${s}.mp4`, mimeType: "video/mp4", size: 10, status: "ready" } });
    const post = await db.post.create({ data: { userId: user.id, mediaId: media.id, status: "published", title: "Old" } });
    const t = await db.postTarget.create({ data: { postId: post.id, platform: "youtube", socialAccountId: old.id, platformStatus: "published" } });
    await saveConnectedAccount(user.id, "youtube", { platformUserId: `yt-new-${s}`, username: "new", accessToken: "n" });
    const kept = await db.socialAccount.findUnique({ where: { id: old.id } });
    expect(kept?.status).toBe("disconnected");
    expect((await db.postTarget.findUnique({ where: { id: t.id } }))?.socialAccountId).toBe(old.id);
    const back = await saveConnectedAccount(user.id, "youtube", { platformUserId: `yt-old-${s}`, username: "old", accessToken: "t2" });
    expect(back.id).toBe(old.id);
    expect(back.status).toBe("connected");
  });
});
