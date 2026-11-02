/**
 * 1095: disconnect -> reconnect the same account -> connect a different one, on every platform.
 * Root cause pinned here: disconnect hard-deleted the row (so nothing remembered the account), the sign-in
 * never asked the platform for a fresh login, and the callback upserted whatever came back, silently
 * reconnecting the old account or replacing the current one.
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { decideConnect, googleMayLink, parseIntent, pickIdentity, type KnownAccount } from "../lib/connect-decision";
import { PLATFORMS, type Platform } from "../lib/domain";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
let db: typeof import("../lib/db").db;
let enc: (s: string) => string;
let dec: (s: string) => string;
let n = 0;
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  const c = await import("../lib/crypto");
  enc = c.encrypt;
  dec = c.decrypt;
}, 60_000);

type Calls = { url: string; method: string }[];
function stubFetch(handler: (url: string) => Response = () => new Response("{}", { status: 200 })): Calls {
  const calls: Calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, method: (init.method ?? "GET").toUpperCase() });
    return handler(url);
  }) as typeof fetch;
  return calls;
}

const row = (id: string, pid: string, status = "connected", username = `@${pid}`): KnownAccount => ({ id, platformUserId: pid, status, username });
async function user() {
  return db.user.create({ data: { name: `R ${++n}`, email: `r1095-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
}
async function acct(userId: string, platform: Platform, pid: string, status = "connected") {
  return db.socialAccount.create({ data: { userId, platform, platformUserId: pid, username: `@${pid}`, accessToken: enc(`tok-${pid}`), refreshToken: enc(`ref-${pid}`), status } });
}

describe("1095 decision: never reconnect, merge or replace without asking", () => {
  test("a brand-new account on an empty platform is saved", () => {
    expect(decideConnect({ rows: [], platformUserId: "a", intent: "auto", multi: false }).kind).toBe("save");
  });
  test("an account disconnected earlier is not silently reconnected: the creator is asked", () => {
    const d = decideConnect({ rows: [row("r1", "a", "disconnected")], platformUserId: "a", intent: "auto", multi: false });
    expect(d).toMatchObject({ kind: "known", existing: { id: "r1" }, again: false });
  });
  test("Reconnect pressed on that account reconnects it directly", () => {
    expect(decideConnect({ rows: [row("r1", "a", "needs_reconnect")], platformUserId: "a", intent: "reconnect", expectId: "r1", multi: false }).kind).toBe("save");
    expect(decideConnect({ rows: [row("r1", "a", "disconnected")], platformUserId: "a", intent: "reconnect", expectId: "r1", multi: true }).kind).toBe("save");
  });
  test("asking for a different account and getting the same one back says so (again)", () => {
    const d = decideConnect({ rows: [row("r1", "a")], platformUserId: "a", intent: "new", multi: true });
    expect(d).toMatchObject({ kind: "known", again: true });
  });
  test("Reconnect on one account that signs in as another never overwrites the first", () => {
    const d = decideConnect({ rows: [row("r1", "a", "needs_reconnect")], platformUserId: "b", intent: "reconnect", expectId: "r1", multi: true });
    expect(d).toMatchObject({ kind: "mismatch", expected: { id: "r1" } });
    const known = decideConnect({ rows: [row("r1", "a", "needs_reconnect"), row("r2", "b", "disconnected")], platformUserId: "b", intent: "reconnect", expectId: "r1", multi: true });
    expect(known).toMatchObject({ kind: "known", existing: { id: "r2" }, expected: { id: "r1" } });
  });
  test("one account per platform: a different account asks before replacing", () => {
    const d = decideConnect({ rows: [row("r1", "a")], platformUserId: "b", intent: "new", multi: false });
    expect(d).toMatchObject({ kind: "replace", replaces: [{ id: "r1" }] });
    // Reconnecting a disconnected one while another is connected names what it would replace.
    const k = decideConnect({ rows: [row("r1", "a"), row("r2", "b", "disconnected")], platformUserId: "b", intent: "auto", multi: false });
    expect(k).toMatchObject({ kind: "known", existing: { id: "r2" }, replaces: [{ id: "r1" }] });
  });
  test("multi-account plans add a different account next to the others", () => {
    expect(decideConnect({ rows: [row("r1", "a")], platformUserId: "b", intent: "new", multi: true })).toEqual({ kind: "save", replaces: [] });
  });
  test("identity is the stable id, never the display name", () => {
    const d = decideConnect({ rows: [row("r1", "a", "connected", "@same.name")], platformUserId: "b", intent: "new", multi: true });
    expect(d.kind).toBe("save"); // same name, different account: separate
  });
  test("intent parsing: Add another means a different account; junk falls back to auto", () => {
    expect(parseIntent(null, "1")).toBe("new");
    expect(parseIntent("reconnect", null)).toBe("reconnect");
    expect(parseIntent("<script>", null)).toBe("auto");
  });
  test("Facebook: a different account takes a Page not connected here; Reconnect takes the Page pressed", () => {
    const pages = [{ platformUserId: "p1" }, { platformUserId: "p2" }, { platformUserId: "p3" }];
    const rows = [row("r1", "p1"), row("r2", "p2", "disconnected")];
    expect(pickIdentity(pages[0], pages.slice(1), rows, "new").platformUserId).toBe("p3");
    expect(pickIdentity(pages[0], pages.slice(1), rows, "reconnect", "r2").platformUserId).toBe("p2");
    expect(pickIdentity(pages[0], pages.slice(1), rows, "auto").platformUserId).toBe("p1");
  });
  test("Continue with Google never brings back a disconnected channel or replaces one", () => {
    expect(googleMayLink([], "c1", false)).toBe(true);
    expect(googleMayLink([row("r1", "c1")], "c1", false)).toBe(true); // same, still connected: refresh only
    expect(googleMayLink([row("r1", "c1", "disconnected")], "c1", false)).toBe(false);
    expect(googleMayLink([row("r1", "c1")], "c2", false)).toBe(false);
    expect(googleMayLink([row("r1", "c1")], "c2", true)).toBe(true);
  });
});

describe("1095 disconnect keeps history and wipes keys", () => {
  test("soft disconnect: status, wiped keys, posts and DMs still attached", async () => {
    const { disconnectAccounts } = await import("../lib/accounts");
    const u = await user();
    const a = await acct(u.id, "instagram", `ig-${Date.now()}`);
    const media = await db.media.create({ data: { userId: u.id, originalFilename: "a.mp4", storageKey: `r1095/${Date.now()}.mp4`, mimeType: "video/mp4", size: 10, status: "ready" } });
    const post = await db.post.create({ data: { userId: u.id, mediaId: media.id, status: "published", title: "Kept" } });
    const t = await db.postTarget.create({ data: { postId: post.id, platform: "instagram", socialAccountId: a.id, platformStatus: "published" } });
    const th = await db.dmThread.create({ data: { userId: u.id, accountId: a.id, platform: "instagram", participantId: "p1", lastMessageAt: new Date() } });
    stubFetch();
    expect(await disconnectAccounts(u.id, "instagram")).toBe(1);
    const after = await db.socialAccount.findUnique({ where: { id: a.id } });
    expect(after?.status).toBe("disconnected");
    const left = (() => {
      try {
        return dec(after!.accessToken);
      } catch {
        return ""; // an empty secret doesn't even decrypt: nothing left to use
      }
    })();
    expect(left).toBe("");
    expect(after?.refreshToken).toBeNull();
    expect((await db.postTarget.findUnique({ where: { id: t.id } }))?.socialAccountId).toBe(a.id);
    expect(await db.dmThread.count({ where: { id: th.id } })).toBe(1);
    expect(await disconnectAccounts(u.id, "instagram")).toBe(0); // already disconnected
  });

  test("revokes the grant where the platform allows, unless another studio still uses that account", async () => {
    const { disconnectAccounts } = await import("../lib/accounts");
    const pid = `yt-${Date.now()}`;
    const a = await user();
    const b = await user();
    await acct(a.id, "youtube", pid);
    await acct(b.id, "youtube", pid);
    let calls = stubFetch();
    await disconnectAccounts(a.id, "youtube");
    expect(calls.some((c) => c.url.startsWith("https://oauth2.googleapis.com/revoke"))).toBe(false); // b still posts with it
    expect((await db.socialAccount.findFirst({ where: { userId: b.id, platformUserId: pid } }))?.status).toBe("connected");
    calls = stubFetch(() => new Response("oops", { status: 500 })); // a failing platform never blocks the disconnect
    expect(await disconnectAccounts(b.id, "youtube")).toBe(1);
    expect(calls.filter((c) => c.url.startsWith("https://oauth2.googleapis.com/revoke"))).toHaveLength(1);
  });

  test("only the chosen account of several is disconnected, and only the owner's", async () => {
    const { disconnectAccounts } = await import("../lib/accounts");
    const u = await user();
    const other = await user();
    const x1 = await acct(u.id, "x", `x1-${Date.now()}`);
    const x2 = await acct(u.id, "x", `x2-${Date.now()}`);
    stubFetch();
    expect(await disconnectAccounts(other.id, "x", x1.id)).toBe(0);
    expect(await disconnectAccounts(u.id, "x", x1.id)).toBe(1);
    expect((await db.socialAccount.findUnique({ where: { id: x2.id } }))?.status).toBe("connected");
  });
});

describe("1095 reconnect / switch, end to end on the data layer", () => {
  test("disconnect -> same account comes back -> asked; Reconnect saves into the same row", async () => {
    const { disconnectAccounts, saveConnectedAccount } = await import("../lib/accounts");
    const { resolveConnect, holdChoice, viewChoice, takeChoice } = await import("../lib/connect-choice");
    const u = await user();
    const pid = `li-${Date.now()}`;
    const a = await acct(u.id, "linkedin", pid);
    stubFetch();
    await disconnectAccounts(u.id, "linkedin");
    const prof = { platformUserId: pid, username: "Same Person", accessToken: "SECRET-TOKEN-NEW" };
    const { decision } = await resolveConnect(u.id, "linkedin", prof, "auto");
    expect(decision.kind).toBe("known");
    if (decision.kind === "save") throw new Error("unreachable");
    const id = await holdChoice({ uid: u.id, platform: "linkedin", prof, decision });
    // Nothing saved yet.
    expect((await db.socialAccount.findUnique({ where: { id: a.id } }))?.status).toBe("disconnected");
    const view = await viewChoice(id, u.id);
    expect(JSON.stringify(view)).not.toContain("SECRET-TOKEN-NEW");
    expect(view?.account.username).toBe("Same Person");
    // Another user can't see or take it.
    const intruder = await user();
    expect(await viewChoice(id, intruder.id)).toBeNull();
    expect(await takeChoice(id, intruder.id)).toBeNull();
    const c = await takeChoice(id, u.id);
    expect(c).not.toBeNull();
    expect(await takeChoice(id, u.id)).toBeNull(); // once
    const saved = await saveConnectedAccount(u.id, "linkedin", c!.prof, { replace: c!.decision.replaces.length > 0 });
    expect(saved.id).toBe(a.id);
    expect(saved.status).toBe("connected");
    expect(dec(saved.accessToken)).toBe("SECRET-TOKEN-NEW");
    expect(await db.socialAccount.count({ where: { userId: u.id, platform: "linkedin" } })).toBe(1); // no duplicate
  });

  test("a different account on a one-account plan never replaces the old one unasked", async () => {
    const { saveConnectedAccount } = await import("../lib/accounts");
    const { resolveConnect } = await import("../lib/connect-choice");
    const u = await user();
    const old = await acct(u.id, "tiktok", `tt-old-${Date.now()}`);
    const prof = { platformUserId: `tt-new-${Date.now()}`, username: "@new", accessToken: "n" };
    const { decision } = await resolveConnect(u.id, "tiktok", prof, "new");
    expect(decision).toMatchObject({ kind: "replace", replaces: [{ id: old.id }] });
    await expect(saveConnectedAccount(u.id, "tiktok", prof)).rejects.toMatchObject({ code: "REPLACE_NEEDED" });
    expect((await db.socialAccount.findUnique({ where: { id: old.id } }))?.status).toBe("connected");
    stubFetch();
    await saveConnectedAccount(u.id, "tiktok", prof, { replace: true });
    expect((await db.socialAccount.findUnique({ where: { id: old.id } }))?.status).toBe("disconnected");
  });

  test("two users with the same platform account stay separate", async () => {
    const { saveConnectedAccount, disconnectAccounts } = await import("../lib/accounts");
    const a = await user();
    const b = await user();
    const pid = `th-${Date.now()}`;
    const ra = await saveConnectedAccount(a.id, "threads", { platformUserId: pid, username: "@shared", accessToken: "ta" });
    const rb = await saveConnectedAccount(b.id, "threads", { platformUserId: pid, username: "@shared", accessToken: "tb" });
    expect(ra.id).not.toBe(rb.id);
    stubFetch();
    await disconnectAccounts(a.id, "threads");
    const still = await db.socialAccount.findUnique({ where: { id: rb.id } });
    expect(still?.status).toBe("connected");
    expect(dec(still!.accessToken)).toBe("tb");
  });

  test("practice mode: a fresh sign-in comes back as a different account", async () => {
    const { MockPublisher } = await import("../lib/social/mock");
    for (const p of PLATFORMS) {
      const m = new MockPublisher(p);
      const same = await m.completeConnect(new URL((await m.connect("http://x.test/cb")).url).searchParams.get("code")!);
      const fresh = await m.completeConnect(new URL((await m.connect("http://x.test/cb", { fresh: true })).url).searchParams.get("code")!);
      expect(same.platformUserId).toBe(`mock-${p}-001`);
      expect(fresh.platformUserId).not.toBe(same.platformUserId);
    }
  }, 20_000);
});

describe("1095 fresh sign-in per platform", () => {
  test("Instagram, Facebook and TikTok ask for a fresh login; Google always shows its picker", async () => {
    const url = async (m: { connect: (r: string, o?: { fresh?: boolean }) => Promise<{ url: string }> }, fresh: boolean) => new URL((await m.connect("https://outlly.test/cb", { fresh })).url).searchParams;
    const { InstagramPublisher } = await import("../lib/social/instagram");
    const { FacebookPublisher } = await import("../lib/social/facebook");
    const { TikTokPublisher } = await import("../lib/social/tiktok");
    const { YouTubePublisher } = await import("../lib/social/youtube");
    expect((await url(new InstagramPublisher(), true)).get("force_reauth")).toBe("true");
    expect((await url(new InstagramPublisher(), false)).get("force_reauth")).toBeNull();
    expect((await url(new FacebookPublisher(), true)).get("auth_type")).toBe("reauthenticate");
    expect((await url(new TikTokPublisher(), true)).get("disable_auto_auth")).toBe("1");
    expect((await url(new YouTubePublisher(), false)).get("prompt")).toBe("select_account consent");
  });
  test("every platform has switch guidance; the ones with no picker link their sign-out page", async () => {
    const { SWITCH_HELP, connectHref } = await import("../lib/social/switch-help");
    for (const p of PLATFORMS) {
      expect(SWITCH_HELP[p].how.length).toBeGreaterThan(20);
      if (!SWITCH_HELP[p].picker) expect(SWITCH_HELP[p].signOutUrl).toMatch(/^https:\/\//);
    }
    expect(connectHref("x", { intent: "reconnect", expect: "abc12345" })).toBe("/api/accounts/x/connect?returnTo=%2Faccounts&intent=reconnect&expect=abc12345");
  });
});

describe("1095 wiring", () => {
  test("the callback decides before saving and holds anything that needs asking", () => {
    const cb = src("app/api/accounts/[platform]/callback/route.ts");
    expect(cb).toContain("resolveConnect(user.id, p, raw, intent, pending.expect)");
    expect(cb.indexOf('decision.kind !== "save"')).toBeLessThan(cb.indexOf("await saveConnectedAccount(user.id, p, prof)"));
    expect(cb).toContain("googleMayLink(");
    expect(src("app/api/app/finish/route.ts")).toContain("resolveConnect(held.uid");
  });
  test("disconnect is a soft disconnect, not a delete", () => {
    const r = src("app/api/accounts/[platform]/route.ts");
    expect(r).toContain("disconnectAccounts(user.id, params.platform, id)");
    expect(r).not.toContain("deleteMany");
  });
  test("the list no longer shows disconnected accounts as connected", () => {
    expect(src("app/api/accounts/route.ts")).toContain('rows.filter((a) => a.status !== "disconnected")');
    expect(src("lib/dashboard/pulse.ts")).toContain('status: { not: "disconnected" }');
  });
  test("the dialog asks the exact question with both choices", async () => {
    const { KNOWN_QUESTION, choiceCopy } = await import("../components/settings/ConnectChoiceDialog");
    expect(KNOWN_QUESTION).toBe("This account was previously connected to Outlly. Would you like to reconnect this account or connect a different account?");
    const c = choiceCopy({ platform: "instagram", account: { username: "@maya", displayName: null, avatar: null }, decision: { kind: "known", existing: row("r1", "a", "disconnected"), again: false, replaces: [] } });
    expect(c.body).toBe(KNOWN_QUESTION);
    expect(c.save).toBe("Reconnect Existing Account");
    expect(c.other).toBe("Connect a Different Account");
    const r = choiceCopy({ platform: "x", account: { username: "@b", displayName: null, avatar: null }, decision: { kind: "replace", replaces: [row("r1", "a", "connected", "@a")] } });
    expect(r.save).toBe("Replace @a");
    expect(r.other).toBe("Keep @a");
  });
  test("the choice API never returns tokens and saves only what the dialog named", () => {
    const r = src("app/api/accounts/choice/[id]/route.ts");
    expect(r).toContain("{ replace: c.decision.replaces.length > 0 }");
    expect(r).toContain("viewChoice(params.id");
  });
});

describe("1095 review fixes", () => {
  test("a destination pinned to a disconnected account falls back to the connected one", async () => {
    const { pickAccount } = await import("../lib/profiles-core");
    const old = { id: "old", platform: "youtube", username: "Old", displayName: null, status: "disconnected", createdAt: "2026-01-01" };
    const cur = { id: "new", platform: "youtube", username: "New", displayName: null, status: "connected", createdAt: "2026-06-01" };
    expect(pickAccount("youtube", "old", [old, cur], null)?.id).toBe("new");
    // never falls back onto a disconnected row either
    expect(pickAccount("youtube", null, [old], null)).toBeNull();
    // an account that needs a reconnect keeps its pin (reconnecting it brings the post back)
    const stale = { ...old, status: "needs_reconnect" };
    expect(pickAccount("youtube", "old", [stale, cur], null)?.id).toBe("old");
  });
  test("an answer that comes after another account was connected asks again instead of failing", () => {
    const r = readFileSync("app/api/accounts/choice/[id]/route.ts", "utf8");
    expect(r).toContain('holdChoice({ ...c, decision: { kind: "replace", replaces: now } })');
    expect(readFileSync("components/settings/AccountsView.tsx", "utf8")).toContain("if (r?.choice) return setChoice(r.choice);");
    const cb = readFileSync("app/api/accounts/[platform]/callback/route.ts", "utf8");
    expect(cb).toContain('e instanceof HttpError && e.code === "REPLACE_NEEDED"');
  });
});
