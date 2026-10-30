/** Waitlist mode: queue positions, who may still create an account, and invites, against the test database. */
import { beforeAll, describe, expect, test } from "bun:test";

let db: typeof import("../lib/db").db;
let site: typeof import("../lib/site");
let settings: typeof import("../lib/settings");
let provider: typeof import("../lib/auth-provider");

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  site = await import("../lib/site");
  settings = await import("../lib/settings");
  provider = await import("../lib/auth-provider");
}, 60_000);

const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

describe("waitlist", () => {
  test("off by default: anyone may create an account", async () => {
    await settings.saveConfig("site", { waitlist: false });
    expect(await site.mayCreateAccount(`a-${tag()}@test.dev`)).toBe(true);
  });

  test("joining gives an increasing position, and joining twice keeps the first spot", async () => {
    await settings.saveConfig("site", { waitlist: true });
    const a = `wa-${tag()}@test.dev`;
    const b = `wb-${tag()}@test.dev`;
    const ra = await site.joinWaitlist(a, "Asha");
    await new Promise((r) => setTimeout(r, 5));
    const rb = await site.joinWaitlist(b);
    expect(rb.position).toBe(ra.position + 1);
    const again = await site.joinWaitlist(a.toUpperCase());
    expect(again.already).toBe(true);
    expect(again.position).toBe(ra.position);
  });

  test("on: strangers are refused, invitees and pending teammates are let through", async () => {
    await settings.saveConfig("site", { waitlist: true });
    const stranger = `s-${tag()}@test.dev`;
    expect(await site.mayCreateAccount(stranger)).toBe(false);
    await expect(site.assertMayCreateAccount(stranger)).rejects.toMatchObject({ status: 403, code: "waitlist" });

    const inv = `i-${tag()}@test.dev`;
    await site.joinWaitlist(inv);
    expect(await site.mayCreateAccount(inv)).toBe(false);
    const e = await db.waitlistEntry.findUniqueOrThrow({ where: { email: inv } });
    const sent = await site.inviteWaitlist([e.id]);
    expect(sent).toBe(1);
    expect(await site.mayCreateAccount(inv)).toBe(true);
    const log = await db.emailLog.findFirst({ where: { to: inv, kind: "waitlist" } });
    expect(log).not.toBeNull();

    const owner = await db.user.create({ data: { name: "Owner", email: `o-${tag()}@test.dev`, passwordHash: "x" } });
    const mate = `m-${tag()}@test.dev`;
    await db.teamMember.create({ data: { ownerId: owner.id, email: mate, tokenHash: `h-${tag()}` } });
    expect(await site.mayCreateAccount(mate)).toBe(true);
  });

  test("Google sign-in can't create a new account while on, but existing users still sign in", async () => {
    await settings.saveConfig("site", { waitlist: true });
    await expect(provider.signInWithGoogle({ email: `g-${tag()}@test.dev` })).rejects.toMatchObject({ status: 403 });
    const u = await db.user.create({ data: { name: "Old", email: `old-${tag()}@test.dev`, passwordHash: "x" } });
    const r = await provider.signInWithGoogle({ email: u.email });
    expect(r).toEqual({ id: u.id, created: false });
  });

  test("1058: Google makes no new account without the 18+ confirmation, existing members unaffected", async () => {
    await settings.saveConfig("site", { waitlist: false });
    const fresh = `age-${tag()}@test.dev`;
    await expect(provider.signInWithGoogle({ email: fresh })).rejects.toMatchObject({ status: 403, code: "age" });
    expect(await db.user.findUnique({ where: { email: fresh } })).toBeNull();
    const made = await provider.signInWithGoogle({ email: fresh }, { adult: true });
    expect(made.created).toBe(true);
    expect(await provider.signInWithGoogle({ email: fresh })).toEqual({ id: made.id, created: false });
  });

  test("turning it off with inviteAll emails everyone still waiting", async () => {
    await settings.saveConfig("site", { waitlist: true });
    await site.joinWaitlist(`late-${tag()}@test.dev`);
    const waiting = await db.waitlistEntry.count({ where: { invitedAt: null } });
    const r = await site.setWaitlist(false, "test", { inviteAll: true });
    expect(r.invited).toBe(waiting);
    expect(await db.waitlistEntry.count({ where: { invitedAt: null } })).toBe(0);
    expect((await site.siteStatus()).waitlist).toBe(false);
    expect(await site.mayCreateAccount(`any-${tag()}@test.dev`)).toBe(true);
  });
});
