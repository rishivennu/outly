/**
 * Phase 2 posts server, pure parts: draft conflicts, double-booking detection, platform limits, Instagram's
 * moving publishing cap and the recovery actions the calendar offers per error code.
 */
import { describe, expect, test } from "bun:test";
import { CONFLICT_WINDOW_MS, draftConflict, scheduleConflicts, serverDraft } from "../lib/posts/conflicts";
import { capIssue, copyLimitIssues, mediaLimitIssues, overMovingCap, PUBLISH_CAPS } from "../lib/posts/limits";
import { recoveryActions } from "../lib/posts/recovery";

const stored = (updatedAt: string) => ({
  id: "p1",
  mediaId: "m1",
  title: "Trip",
  story: "story",
  hook: "hook",
  updatedAt: new Date(updatedAt),
  targets: [{ platform: "instagram", socialAccountId: "a1", title: null, caption: "hello", description: null, hashtags: "#a", firstComment: null }],
});

describe("draftConflict", () => {
  const s = stored("2026-11-15T10:00:05.000Z");
  test("no base: never a conflict (older clients)", () => {
    expect(draftConflict(s, { title: "Other" }, undefined)).toBeNull();
  });
  test("stored is not newer: no conflict", () => {
    expect(draftConflict(s, { title: "Other" }, "2026-11-15T10:00:05.000Z")).toBeNull();
    expect(draftConflict(s, { title: "Other" }, "2026-11-15T10:00:09.000Z")).toBeNull();
  });
  test("stored is newer but the edit repeats what is stored: no conflict", () => {
    expect(draftConflict(s, { title: "Trip ", targets: [{ platform: "instagram", caption: "hello" }] }, "2026-11-15T10:00:00.000Z")).toBeNull();
  });
  test("stored is newer and the edit differs: the server copy comes back", () => {
    const c = draftConflict(s, { targets: [{ platform: "instagram", caption: "mine" }] }, "2026-11-15T10:00:00.000Z");
    expect(c).toEqual(serverDraft(s));
    expect(c!.updatedAt).toBe("2026-11-15T10:00:05.000Z");
    expect(c!.targets[0]).toMatchObject({ platform: "instagram", socialAccountId: "a1", caption: "hello", enabled: true });
  });
  test("full save: a destination switched on or off is a difference", () => {
    expect(draftConflict(s, { targets: [{ platform: "instagram", caption: "hello", hashtags: "#a" }, { platform: "x", caption: "hi" }] }, "2026-11-15T10:00:00.000Z", { replaceTargets: true })).not.toBeNull();
  });
  test("a bad base is ignored", () => {
    expect(draftConflict(s, { title: "x" }, "not a date")).toBeNull();
  });
});

describe("scheduleConflicts", () => {
  const at = new Date("2026-11-20T12:00:00Z");
  const b = (o: Partial<{ postId: string; mediaId: string; accountId: string; min: number; platform: string }>) => ({
    postId: o.postId ?? "p2",
    title: "Other\nsecond line",
    mediaId: o.mediaId ?? "m1",
    accountId: o.accountId ?? "a1",
    platform: o.platform ?? "instagram",
    scheduledAt: new Date(at.getTime() + (o.min ?? 0) * 60_000),
  });
  const run = (booked: ReturnType<typeof b>[]) => scheduleConflicts({ postId: "p1", mediaId: "m1", at, want: [{ accountId: "a1", platform: "instagram" }], booked });
  test("same media, same account, within 10 minutes", () => {
    expect(run([b({ min: 9 })])).toEqual([{ postId: "p2", title: "Other", scheduledAt: new Date(at.getTime() + 9 * 60_000).toISOString(), platform: "instagram" }]);
    expect(run([b({ min: -9 })])).toHaveLength(1);
  });
  test("10 minutes apart or more, other media, other account, or the post itself: fine", () => {
    expect(CONFLICT_WINDOW_MS).toBe(600_000);
    expect(run([b({ min: 10 }), b({ min: -10 }), b({ mediaId: "m2" }), b({ accountId: "a2" }), b({ postId: "p1" })])).toEqual([]);
  });
  test("one entry per other post and platform", () => {
    expect(run([b({}), b({ min: 1 })])).toHaveLength(1);
  });
});

describe("platform limits", () => {
  test("caption counted the way the publisher sends it (caption + hashtags)", () => {
    expect(copyLimitIssues({ platform: "instagram", caption: "a".repeat(2190), hashtags: "#b".repeat(4) })).toEqual([]);
    const over = copyLimitIssues({ platform: "instagram", caption: "a".repeat(2195), hashtags: "#bbbb" });
    expect(over).toHaveLength(1);
    expect(over[0].message).toBe("The Instagram caption is 2 characters over its 2200 character limit.");
  });
  test("X counts only the post text; YouTube the title and description", () => {
    expect(copyLimitIssues({ platform: "x", caption: "a".repeat(280), hashtags: "#tag" })).toEqual([]);
    expect(copyLimitIssues({ platform: "x", caption: "a".repeat(281) })[0].platform).toBe("x");
    const yt = copyLimitIssues({ platform: "youtube", title: "t".repeat(101), description: "d".repeat(5001) });
    expect(yt.map((i) => i.message)).toEqual(["The YouTube title is 1 characters over its 100 character limit.", "The YouTube description is 1 characters over its 5000 character limit."]);
  });
  test("first comment over its limit; a Story has no caption to check", () => {
    expect(copyLimitIssues({ platform: "x", caption: "hi", firstComment: "c".repeat(281) })[0].message).toContain("first comment");
    expect(copyLimitIssues({ platform: "instagram", caption: "a".repeat(3000) }, "story")).toEqual([]);
  });
  test("media errors block, warnings never do", () => {
    expect(mediaLimitIssues("x", [{ level: "warning", message: "w" }, { level: "error", message: "X allows up to 140s here. Yours is 200s." }])).toEqual([{ code: "platform_limit", platform: "x", message: "X allows up to 140s here. Yours is 200s." }]);
  });
  test("no em or en dashes in user-facing copy", () => {
    const all = [...copyLimitIssues({ platform: "youtube", title: "t".repeat(200), description: "d".repeat(6000), firstComment: "c".repeat(20000) }), capIssue("instagram")!].map((i) => i.message).join(" ");
    expect(all).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("Instagram moving 24 hour cap", () => {
  const H = 3600_000;
  const at = Date.UTC(2026, 10, 20, 12);
  test("Meta's documented 100 per 24 hours", () => expect(PUBLISH_CAPS.instagram).toEqual({ max: 100, windowMs: 24 * H }));
  test("99 others in the window: one more fits; 100: it doesn't", () => {
    const ninetyNine = Array.from({ length: 99 }, (_, i) => at - (i + 1) * 60_000);
    expect(overMovingCap(ninetyNine, at, 100, 24 * H)).toBe(false);
    expect(overMovingCap([...ninetyNine, at + 20 * H], at, 100, 24 * H)).toBe(true);
  });
  test("the window moves: posts 30 h apart never share one", () => {
    const early = Array.from({ length: 60 }, () => at - 13 * H);
    const late = Array.from({ length: 60 }, () => at + 13 * H);
    expect(overMovingCap([...early, ...late], at, 100, 24 * H)).toBe(false);
    expect(overMovingCap([...early, ...late], at, 60, 24 * H)).toBe(true);
  });
});

describe("recovery actions", () => {
  const acts = (errorCode: string | null, status = "failed") => recoveryActions({ platform: "instagram", status, errorCode, postId: "p1" }).map((a) => a.kind);
  test("only for a destination that failed", () => {
    expect(acts("AUTH_EXPIRED", "published")).toEqual([]);
    expect(acts(null, "pending")).toEqual([]);
  });
  test("per error code", () => {
    expect(acts("AUTH_EXPIRED")).toEqual(["reconnect", "retry"]);
    expect(acts("NOT_CONNECTED")).toEqual(["reconnect", "retry"]);
    expect(acts("MEDIA_REJECTED")).toEqual(["edit"]);
    expect(acts("NETWORK")).toEqual(["retry", "reschedule"]);
    expect(acts("RATE_LIMITED")).toEqual(["reschedule", "retry"]);
    expect(acts("CANCELED")).toEqual(["retry", "reschedule"]);
    expect(acts("UNKNOWN")).toEqual(["retry", "edit"]);
    expect(acts(null)).toEqual(["retry", "edit"]);
  });
  test("links go where the action is", () => {
    const [reconnect] = recoveryActions({ platform: "youtube", status: "failed", errorCode: "AUTH_EXPIRED" });
    expect(reconnect).toEqual({ kind: "reconnect", label: "Reconnect YouTube", href: "/accounts" });
    expect(recoveryActions({ platform: "x", status: "failed", errorCode: "MEDIA_REJECTED", postId: "p9" })[0].href).toBe("/create?post=p9");
    expect(recoveryActions({ platform: "x", status: "failed", errorCode: "MEDIA_REJECTED" })[0].href).toBeUndefined();
    const labels = ["AUTH_EXPIRED", "MEDIA_REJECTED", "DUPLICATE", "NEEDS_APPROVAL", "CANCELED", null].flatMap((c) => recoveryActions({ platform: "x", status: "failed", errorCode: c }).map((a) => a.label)).join(" ");
    expect(labels).not.toMatch(/[\u2013\u2014]/);
  });
});
