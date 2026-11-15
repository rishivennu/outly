/**
 * Phase 2 (1155): the pure parts of the Messages tab (cursors, page merges, row status, typed Meta errors) and
 * source checks that the UI stays honest: archive says it is Outlly only, a rate limit shows when to retry,
 * and "Sent" only appears for what Meta accepted.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendPage, decodeCursor, encodeCursor, mergeHead, mergeLatest, prependOlder } from "../lib/messages/paging";
import { dmFailure, waitWords } from "../lib/messages/errors";
import { listQuery, secondsUntil, threadStatus, visibleThreads } from "../components/inbox/messages/status";
import type { ThreadView } from "../lib/messages/service";

const src = (f: string) => readFileSync(join(import.meta.dir, "..", f), "utf8");
const row = (id: string, at: number, extra: Partial<ThreadView> = {}) =>
  ({ id, lastMessageAt: new Date(at).toISOString(), unread: 0, snippet: "You: ok", canReply: true, participantName: id, participantHandle: null, ...extra }) as ThreadView;

describe("cursors", () => {
  test("round trip, and junk is refused", () => {
    const c = encodeCursor(new Date(1_700_000_000_000), "ckabc123");
    expect(decodeCursor(c)).toEqual({ at: new Date(1_700_000_000_000), id: "ckabc123" });
    for (const bad of ["", null, undefined, "abc", "1.2.3", "12.", ".id", "1.id;drop", `${"9".repeat(16)}.x`]) expect(decodeCursor(bad)).toBeNull();
  });
});

describe("page merges", () => {
  test("a refreshed first page keeps older pages below it, without repeats", () => {
    const prev = [row("a", 50), row("b", 40), row("c", 30), row("d", 20)];
    const head = [row("c", 60), row("a", 50)];
    const r = mergeHead(prev, "cur-deep", head, "cur-head");
    expect(r.threads.map((t) => t.id)).toEqual(["c", "a", "b", "d"]);
    expect(r.nextCursor).toBe("cur-deep");
  });
  test("when the head is the whole list, it replaces everything", () => {
    expect(mergeHead([row("a", 1), row("z", 0)], null, [row("a", 2)], null)).toEqual({ threads: [row("a", 2)], nextCursor: null });
  });
  test("an older page is appended once", () => {
    expect(appendPage([row("a", 3), row("b", 2)], [row("b", 2), row("c", 1)]).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
  test("the newest messages replace their stretch; loaded history stays; an unsent one goes", () => {
    const m = (id: string, s: number) => ({ id, sentAt: new Date(s * 1000).toISOString() });
    const prev = [m("1", 1), m("2", 2), m("3", 3), m("4", 4)];
    expect(mergeLatest(prev, [m("2", 2), m("4", 4), m("5", 5)]).map((x) => x.id)).toEqual(["1", "2", "4", "5"]);
    expect(mergeLatest(null, [m("1", 1)]).map((x) => x.id)).toEqual(["1"]);
    expect(prependOlder([m("3", 3)], [m("1", 1), m("3", 3)]).map((x) => x.id)).toEqual(["1", "3"]);
  });
});

describe("row status and filters", () => {
  test("needs reply, replied, window closed", () => {
    expect(threadStatus(row("a", 1, { unread: 1 }))).toBe("needs_reply");
    expect(threadStatus(row("a", 1, { snippet: "hello?" }))).toBe("needs_reply");
    expect(threadStatus(row("a", 1))).toBe("replied");
    expect(threadStatus(row("a", 1, { canReply: false, unread: 2 }))).toBe("window_closed");
  });
  test("needs view keeps the open one; search reads name, handle and preview", () => {
    const list = [row("asha", 3, { unread: 1 }), row("ben", 2), row("cara", 1, { snippet: "price?" })];
    expect(visibleThreads(list, { view: "needs" }, "", null).map((t) => t.id)).toEqual(["asha", "cara"]);
    expect(visibleThreads(list, { view: "needs" }, "", "ben").map((t) => t.id)).toEqual(["asha", "ben", "cara"]);
    expect(visibleThreads(list, { view: "all" }, "PRICE", null).map((t) => t.id)).toEqual(["cara"]);
  });
  test("query strings", () => {
    expect(listQuery({ view: "needs", platform: "all" })).toBe("");
    expect(listQuery({ view: "all", platform: "instagram" }, { take: 60 })).toBe("?platform=instagram&take=60");
    expect(listQuery({ view: "archived", platform: "all" }, { cursor: "1.a" })).toBe("?view=archived&cursor=1.a");
    expect(listQuery({ view: "unread", platform: "facebook" }, { sync: true })).toBe("?platform=facebook&view=unread&sync=1");
  });
  test("retry countdown", () => {
    expect(secondsUntil(null)).toBe(0);
    expect(secondsUntil(new Date(10_500).toISOString(), 1_000)).toBe(10);
    expect(secondsUntil(new Date(0).toISOString(), 1_000)).toBe(0);
  });
});

describe("typed Meta errors", () => {
  test("rate limit with and without Meta's wait", () => {
    const f = dmFailure("instagram", { code: "RATE_LIMITED", retryAfterMs: 120_000 }, "send", 0);
    expect(f).toMatchObject({ status: 429, code: "RATE_LIMITED", retryAfterSec: 120, retryAt: new Date(120_000).toISOString() });
    expect(f.message).toContain("about 2 minutes");
    const g = dmFailure("facebook", { code: "RATE_LIMITED" }, "send");
    expect(g.retryAt).toBeNull();
    expect(g.message).toContain("Try again in a few minutes");
    expect(waitWords(30)).toBe("about a minute");
    expect(waitWords(7200)).toBe("about 2 hours");
  });
  test("permission, auth and rejection", () => {
    expect(dmFailure("instagram", { code: "FORBIDDEN" })).toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(dmFailure("instagram", { code: "FORBIDDEN" }, "sync").message).toContain("messaging permission");
    expect(dmFailure("facebook", { code: "AUTH_EXPIRED" })).toMatchObject({ status: 409, code: "NOT_CONNECTED" });
    expect(dmFailure("facebook", { code: "MEDIA_REJECTED" })).toMatchObject({ status: 422, code: "REJECTED" });
  });
  test("no dashes in user copy", () => {
    for (const f of ["lib/messages/errors.ts", "components/inbox/messages/ThreadActions.tsx", "components/inbox/messages/ThreadFilters.tsx", "components/inbox/MessagesView.tsx"]) expect(src(f)).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("Messages UI stays honest", () => {
  const v = src("components/inbox/MessagesView.tsx");
  test("archive is labelled as Outlly only, with undo", () => {
    expect(src("components/inbox/messages/ThreadActions.tsx")).toContain("Archive in Outlly");
    expect(src("components/inbox/messages/ThreadActions.tsx")).toContain("Hides it here only. A new message brings it back.");
    expect(v).toContain('label: "Undo"');
  });
  test("rate limited sends wait for Meta's retry time", () => {
    expect(v).toContain("Retry after {clock(p.retryAt!)}");
    expect(v).toContain("secondsUntil(p.retryAt, now) > 0");
  });
  test("Sent is only drawn for stored, accepted messages, never for practice", () => {
    expect(v).toContain("m.id === lastOutId && (thread.practice ?");
    expect(v).toContain('state: "failed", error: msg, code, retryAt');
  });
  test("platform chips come from the server's connected DM platforms", () => {
    expect(v).toContain("platforms={data.platforms ?? []}");
    expect(src("components/inbox/messages/ThreadFilters.tsx")).toContain("platforms.length > 1");
    expect(src("lib/messages/service.ts")).toContain("DM_PLATFORMS.filter((p) => accts.some((a) => a.platform === p))");
  });
});
