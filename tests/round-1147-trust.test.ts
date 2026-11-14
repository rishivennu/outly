/**
 * 1147 trust: hashed anti-abuse signals, risk scoring, the once-per-person 7-day trial, appeals and the
 * account-deletion cleanup. Policy is switched on per test through the subs.policy setting.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

let db: typeof import("../lib/db").db;
let signals: typeof import("../lib/subscriptions/signals");
let risk: typeof import("../lib/subscriptions/risk");
let trial: typeof import("../lib/subscriptions/trial");
let policy: typeof import("../lib/subscriptions/policy");
let account: typeof import("../lib/account");
let ent: typeof import("../lib/billing/entitlements");
let n = 0;

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  signals = await import("../lib/subscriptions/signals");
  risk = await import("../lib/subscriptions/risk");
  trial = await import("../lib/subscriptions/trial");
  policy = await import("../lib/subscriptions/policy");
  account = await import("../lib/account");
  ent = await import("../lib/billing/entitlements");
  await (await import("../lib/billing/plans")).ensurePlans();
}, 60_000);

const uuid = () => crypto.randomUUID();
function req(o: { ip?: string; device?: string | null; ua?: string } = {}) {
  const headers = new Headers({ "x-forwarded-for": o.ip ?? `10.${n % 250}.${(n * 7) % 250}.${(n * 13) % 250}`, "user-agent": o.ua ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" });
  if (o.device) headers.set("cookie", `oly_did=${o.device}`);
  return new NextRequest("http://localhost/api/billing/trial", { method: "POST", headers });
}
async function user(extra: Record<string, unknown> = {}) {
  n++;
  return db.user.create({ data: { name: `T ${n}`, email: `r1147t-${n}-${Date.now()}@test.dev`, passwordHash: "x", ...extra } });
}
async function setPolicy(patch: Record<string, unknown>) {
  const cur = await policy.getPolicy();
  const value = JSON.stringify({ ...cur, ...patch });
  await db.setting.upsert({ where: { key: policy.POLICY_KEY }, create: { key: policy.POLICY_KEY, value }, update: { value } });
  policy.clearPolicyCache();
}
const on = () => setPolicy({ enabled: true, trialDays: 7 });

describe("1147 signals: hashed, coarse, no raw IP", () => {
  test("network prefix is /24 for IPv4 and /48 for IPv6", () => {
    expect(signals.networkPrefix("203.0.113.77")).toBe("203.0.113.0/24");
    expect(signals.networkPrefix("::ffff:203.0.113.9")).toBe("203.0.113.0/24");
    expect(signals.networkPrefix("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48");
    expect(signals.networkPrefix("2001:0db8:abcd:0012:0000:0000:0000:0001")).toBe("2001:db8:abcd::/48");
  });
  test("UA family drops versions", () => {
    expect(signals.uaFamily("Mozilla/5.0 (Windows NT 10.0) Chrome/130.0")).toBe("chrome/windows");
    expect(signals.uaFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile Safari/604.1")).toBe("safari/ios");
    expect(signals.uaFamily("Mozilla/5.0 (Linux; Android 14) Chrome/129 Mobile")).toBe("chrome/android");
  });
  test("device id only from a UUID cookie", () => {
    const d = uuid();
    expect(signals.deviceIdFromRequest(req({ device: d }))).toBe(d);
    expect(signals.deviceIdFromRequest(req({ device: "not-a-uuid" }))).toBeNull();
  });
  test("captureSignal stores hashes, never the address", async () => {
    const u = await user();
    const d = uuid();
    const s = await signals.captureSignal({ req: req({ ip: "198.51.100.23", device: d }), userId: u.id, event: "signup" });
    const row = await db.signupSignal.findUniqueOrThrow({ where: { id: s.id } });
    const all = JSON.stringify(row);
    expect(all).not.toContain("198.51.100");
    expect(all).not.toContain(d);
    expect(row.ipHash).toBe(signals.signalHash("ip", "198.51.100.23"));
    expect(row.netHash).toBe(signals.signalHash("net", "198.51.100.0/24"));
  });
  test("signals older than 90 days are pruned", async () => {
    const old = await db.signupSignal.create({ data: { event: "signup", ipHash: "x", netHash: "y", createdAt: new Date(Date.now() - 91 * 864e5) } });
    const fresh = await db.signupSignal.create({ data: { event: "signup", ipHash: "x", netHash: "y" } });
    await signals.pruneSignals();
    expect(await db.signupSignal.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await db.signupSignal.findUnique({ where: { id: fresh.id } })).not.toBeNull();
  });
});

describe("1147 risk scoring", () => {
  const w = { ipCap: 10, high: 70, medium: 40 };
  test("IP alone can never reach medium", () => {
    const r = risk.scoreRisk([{ code: "same_ip", weight: 5, detail: "" }, { code: "same_ip", weight: 5, detail: "" }, { code: "same_ip", weight: 5, detail: "" }], w);
    expect(r.score).toBe(10);
    expect(r.action).toBe("none");
  });
  test("levels and actions", () => {
    expect(risk.scoreRisk([{ code: "device_match", weight: 60, detail: "" }], w)).toEqual({ score: 60, level: "medium", action: "verify" });
    expect(risk.scoreRisk([{ code: "email_match", weight: 70, detail: "" }], w)).toEqual({ score: 70, level: "high", action: "deny_offer" });
    expect(risk.scoreRisk([{ code: "device_match", weight: 60, detail: "" }, { code: "phone_new", weight: -30, detail: "" }], w).action).toBe("none");
  });
});

describe("1147 trial", () => {
  test("policy off: trials are disabled, nothing is written", async () => {
    await setPolicy({ enabled: false });
    const u = await user();
    expect(await trial.startTrial({ userId: u.id, req: req() })).toEqual({ ok: false, reason: "disabled" });
    expect(await db.trial.count({ where: { userId: u.id } })).toBe(0);
  });

  test("starts once: Creator access for 7 days, ledger marked, second start refused", async () => {
    await on();
    const u = await user();
    const r = await trial.startTrial({ userId: u.id, req: req({ device: uuid() }), source: "welcome" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Math.round((r.trial.endsAt.getTime() - r.trial.startedAt.getTime()) / 864e5)).toBe(7);
    expect((await ent.entitlements(u.id)).planSlug).toBe("creator");
    expect(await db.offerLedger.count({ where: { userId: u.id, trialUsedAt: { not: null } } })).toBeGreaterThanOrEqual(2); // email + device
    expect(await trial.startTrial({ userId: u.id, req: req() })).toEqual({ ok: false, reason: "used" });
    const s = await trial.trialState(u.id);
    expect(s.trial?.status).toBe("active");
    expect(s.trial?.daysLeft).toBe(7);
    expect(s.canStart).toBe(false);
  });

  test("trialDays is capped at 7 and 0 disables", async () => {
    await setPolicy({ enabled: true, trialDays: 30 });
    const u = await user();
    const r = await trial.startTrial({ userId: u.id, req: req() });
    expect(r.ok && Math.round((r.trial.endsAt.getTime() - r.trial.startedAt.getTime()) / 864e5)).toBe(7);
    await setPolicy({ enabled: true, trialDays: 0 });
    expect((await trial.startTrial({ userId: (await user()).id, req: req() })).ok).toBe(false);
    await on();
  });

  test("same inbox with Gmail dots and +tag: used", async () => {
    await on();
    const tag = `t${Date.now()}${n}`;
    const a = await user({ email: `${tag}.x@gmail.com` });
    expect((await trial.startTrial({ userId: a.id, req: req() })).ok).toBe(true);
    const b = await user({ email: `${tag.split("").join(".")}x+again@googlemail.com` });
    expect(await trial.startTrial({ userId: b.id, req: req() })).toMatchObject({ ok: false, reason: "used" });
  });

  test("a second account with the same device cookie: the ledger refuses it as used", async () => {
    await on();
    const d = uuid();
    const a = await user();
    expect((await trial.startTrial({ userId: a.id, req: req({ device: d, ip: "192.0.2.10" }) })).ok).toBe(true);
    const b = await user();
    // device key is on the ledger as used: the direct check refuses it outright
    expect(await trial.startTrial({ userId: b.id, req: req({ device: d, ip: "192.0.2.11" }) })).toMatchObject({ ok: false, reason: "used" });
  });

  test("risk: shared device signal (other cookie jar cleared) asks for verification, then passes once verified", async () => {
    await on();
    const d = uuid();
    const a = await user();
    expect((await trial.startTrial({ userId: a.id, req: req({ device: d }) })).ok).toBe(true);
    const b = await user();
    // b's signal carries the same device hash, but the assessment is made without the raw id (ledger direct check skipped)
    await signals.captureSignal({ req: req({ device: d }), userId: b.id, event: "signup" });
    const r = await risk.assessRisk({ userId: b.id, context: "trial" });
    expect(r.reasons.map((x) => x.code)).toContain("device_match");
    expect(r.action).toBe("verify");
    expect(r.relatedUserIds).toContain(a.id);
    const flag = await db.riskFlag.findUniqueOrThrow({ where: { id: r.flagId! } });
    expect(flag.level).toBe("medium");
    await db.user.update({ where: { id: b.id }, data: { phone: `+9198${String(Date.now()).slice(-8)}`, phoneVerifiedAt: new Date() } });
    const r2 = await risk.assessRisk({ userId: b.id, context: "trial" });
    expect(r2.action).toBe("none");
  });

  test("email + device: high, deny_offer; appeal opens a linked ticket; clear never overrides an inbox match", async () => {
    await on();
    const tag = `h${Date.now()}${n}`;
    const d = uuid();
    const a = await user({ email: `${tag}@gmail.com` });
    expect((await trial.startTrial({ userId: a.id, req: req({ device: d }) })).ok).toBe(true);
    const b = await user({ email: `${tag}+2@gmail.com` });
    await signals.captureSignal({ req: req({ device: d }), userId: b.id, event: "signup" });
    const r = await risk.assessRisk({ userId: b.id, context: "checkout" });
    expect(r.level).toBe("high");
    expect(r.action).toBe("deny_offer");
    const ap = await risk.appeal({ userId: b.id, message: "This is my brother's laptop" });
    expect((await db.riskFlag.findUniqueOrThrow({ where: { id: r.flagId! } })).ticketId).toBe(ap.ticketId);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ap.ticketId } })).userId).toBe(b.id);
    await risk.clearFlag(r.flagId!, "admin@test");
    // inbox is the same person: clearing never overrides an identity match
    expect((await risk.assessRisk({ userId: b.id, context: "checkout" })).action).toBe("deny_offer");
  });

  test("admin clear restores a device-only refusal; confirm keeps it denied", async () => {
    await on();
    const d = uuid();
    const a = await user();
    await trial.startTrial({ userId: a.id, req: req({ device: d }) });
    const b = await user();
    await signals.captureSignal({ req: req({ device: d }), userId: b.id, event: "signup" });
    const r = await risk.assessRisk({ userId: b.id, context: "trial" });
    expect(r.action).toBe("verify");
    await risk.clearFlag(r.flagId!, "admin@test", "same household");
    expect((await risk.assessRisk({ userId: b.id, context: "trial" })).action).toBe("none");
    const c = await user();
    await signals.captureSignal({ req: req({ device: d }), userId: c.id, event: "signup" });
    const rc = await risk.assessRisk({ userId: c.id, context: "trial" });
    await risk.confirmFlag(rc.flagId!, "admin@test");
    expect((await risk.assessRisk({ userId: c.id, context: "trial" })).action).toBe("deny_offer");
  });

  test("cancel ends access now and the trial stays used", async () => {
    await on();
    const u = await user();
    await trial.startTrial({ userId: u.id, req: req() });
    expect((await trial.cancelTrial(u.id)).ok).toBe(true);
    expect((await ent.entitlements(u.id)).planSlug).toBe("free");
    expect((await db.trial.findUniqueOrThrow({ where: { userId: u.id } })).status).toBe("canceled");
    expect(await trial.startTrial({ userId: u.id, req: req() })).toMatchObject({ ok: false, reason: "used" });
  });

  test("sweep: reminders at 2 days and on the last day, once each; expiry drops to Free", async () => {
    await on();
    const u = await user();
    const r = await trial.startTrial({ userId: u.id, req: req() });
    if (!r.ok) throw new Error("trial did not start");
    const end = r.trial.endsAt.getTime();
    await trial.sweepTrials(new Date(end - 3 * 864e5));
    expect((await db.trial.findUniqueOrThrow({ where: { id: r.trial.id } })).remindedAt).toBeNull();
    await trial.sweepTrials(new Date(end - 1.5 * 864e5));
    await trial.sweepTrials(new Date(end - 1.4 * 864e5));
    expect((await db.trial.findUniqueOrThrow({ where: { id: r.trial.id } })).remindedAt).toBe("2d");
    expect(await db.notice.count({ where: { userId: u.id, key: `trial:${r.trial.id}:2d` } })).toBe(1);
    await trial.sweepTrials(new Date(end - 3600_000));
    expect((await db.trial.findUniqueOrThrow({ where: { id: r.trial.id } })).remindedAt).toBe("0d");
    expect(await db.notice.count({ where: { userId: u.id, key: `trial:${r.trial.id}:0d` } })).toBe(1);
    const res = await trial.sweepTrials(new Date(end + 1000));
    expect(res.expired).toBeGreaterThanOrEqual(1);
    expect((await db.trial.findUniqueOrThrow({ where: { id: r.trial.id } })).status).toBe("expired");
    expect((await ent.entitlements(u.id)).planSlug).toBe("free");
  });

  test("convert during trial: converted, grant ended", async () => {
    await on();
    const u = await user();
    await trial.startTrial({ userId: u.id, req: req() });
    expect(await trial.convertTrial(u.id)).toBe(true);
    expect((await db.trial.findUniqueOrThrow({ where: { userId: u.id } })).status).toBe("converted");
    expect(await db.planGrant.count({ where: { userId: u.id, source: "trial", status: "active" } })).toBe(0);
  });

  test("already paid: no trial", async () => {
    await on();
    const u = await user();
    await db.payment.create({ data: { userId: u.id, provider: "mock", providerRef: `r1147-${uuid()}`, amountMinor: 97900, currency: "INR", status: "succeeded" } });
    expect(await trial.startTrial({ userId: u.id, req: req() })).toMatchObject({ ok: false, reason: "already_paid" });
  });
});

describe("1147 account deletion", () => {
  test("signals and trial go; ledger keeps the hash without an owner", async () => {
    await on();
    const u = await user();
    await signals.captureSignal({ req: req({ device: uuid() }), userId: u.id, event: "signup" });
    await trial.startTrial({ userId: u.id, req: req({ device: uuid() }) });
    const ledger = await db.offerLedger.findMany({ where: { userId: u.id } });
    expect(ledger.length).toBeGreaterThan(0);
    await account.deleteAccount({ id: u.id, actor: undefined } as never, u.email);
    expect(await db.signupSignal.count({ where: { userId: u.id } })).toBe(0);
    expect(await db.trial.count({ where: { userId: u.id } })).toBe(0);
    const kept = await db.offerLedger.findMany({ where: { id: { in: ledger.map((l) => l.id) } } });
    expect(kept.length).toBe(ledger.length);
    expect(kept.every((l) => l.userId === null && !!l.trialUsedAt && !!l.keyHash)).toBe(true);
  });
});

describe("1147 wiring", () => {
  const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  test("middleware sets a readable 2-year oly_did only when missing", () => {
    const m = src("middleware.ts");
    expect(m).toContain('if (!req.cookies.get("oly_did")) res.cookies.set("oly_did", crypto.randomUUID(), { path: "/", httpOnly: false');
    expect(m).toContain("60 * 60 * 24 * 730");
  });
  test("signup captures a signal; privacy and cookie banner explain it", () => {
    expect(src("app/api/auth/signup/route.ts")).toContain('captureSignal({ req, userId: user.id, event: "signup" })');
    expect(src("app/(marketing)/privacy/page.tsx")).toContain('id="trials-and-offers"');
    expect(src("components/shared/CookieConsent.tsx")).toContain("device id that stops repeat free trials (fraud prevention)");
  });
});
