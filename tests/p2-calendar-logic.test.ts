/**
 * P2 calendar, pure parts: the days each view lays out, the windows it asks for, merging answers, the upcoming
 * horizon, and how "Requires attention" is derived from real post and account fields.
 */
import { describe, expect, test } from "bun:test";
import { covered, groupByDay, isDayKey, isUnscheduledDraft, mergeWindow, onPage, rangeOf, sameTimeOn, shiftAnchor, upcomingOf, upsertAll, validRange, visibleDays, weekStart } from "../lib/calendar/range";
import { attentionFor, displayStatus, DISPLAY_LABEL, type AccountState, type AttentionPost } from "../lib/posts/attention";
import { readFileSync } from "node:fs";

describe("views and ranges", () => {
  test("day, week and month lay out the right days, Monday first", () => {
    expect(visibleDays("day", "2026-11-15")).toEqual(["2026-11-15"]);
    const w = visibleDays("week", "2026-11-15"); // a Sunday
    expect(w[0]).toBe("2026-11-09");
    expect(w).toHaveLength(7);
    const m = visibleDays("month", "2026-11-20");
    expect(m[0]).toBe("2026-10-26"); // Monday before Nov 1 (a Sunday)
    expect(m.length % 7).toBe(0);
    expect(m.length).toBe(42); // Nov 2026 spans 6 weeks
    expect(visibleDays("month", "2027-02-10")).toHaveLength(28); // Feb 2027 starts on a Monday, 4 weeks
    expect(visibleDays("upcoming", "2026-11-15")).toEqual([]);
  });
  test("paging keeps months on the 1st and weeks on Monday", () => {
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftAnchor("week", "2026-11-15", -1)).toBe("2026-11-02");
    expect(shiftAnchor("day", "2026-12-31", 1)).toBe("2027-01-01");
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
    expect(onPage("month", "2026-11-01", "2026-11-30")).toBe(true);
    expect(onPage("week", "2026-11-15", "2026-11-16")).toBe(false);
  });
  test("a range is midnight to midnight in the creator's timezone and never more than a month grid", () => {
    const r = rangeOf(["2026-11-15"], "Asia/Kolkata");
    expect(r.from.toISOString()).toBe("2026-11-14T18:30:00.000Z");
    expect(+r.to - +r.from).toBe(864e5);
    const big = rangeOf(visibleDays("month", "2026-11-01"), "UTC");
    expect(validRange(big.from, big.to)).toBe(true);
    expect(validRange(new Date("2026-01-01"), new Date("2026-03-01"))).toBe(false);
    expect(validRange(new Date("2026-01-02"), new Date("2026-01-01"))).toBe(false);
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("2026-02-28")).toBe(true);
  });
  test("covered windows, merges and moves", () => {
    expect(covered([[0, 100]], 10, 90)).toBe(true);
    expect(covered([[0, 50]], 10, 90)).toBe(false);
    const a = { id: "a", scheduledAt: "2026-11-15T10:00:00.000Z", publishedAt: null, status: "scheduled" };
    const b = { id: "b", scheduledAt: "2026-11-20T10:00:00.000Z", publishedAt: null, status: "scheduled" };
    const gone = { id: "c", scheduledAt: "2026-11-15T12:00:00.000Z", publishedAt: null, status: "scheduled" };
    const win = [+new Date("2026-11-15T00:00:00Z"), +new Date("2026-11-16T00:00:00Z")] as const;
    const merged = mergeWindow([a, b, gone], [{ ...a, status: "draft" }], ...win);
    expect(merged.map((p) => p.id).sort()).toEqual(["a", "b"]);
    expect(merged.find((p) => p.id === "a")!.status).toBe("draft");
    expect(upsertAll([a], [b, { ...a, status: "failed" }]).map((p) => `${p.id}:${p.status}`)).toEqual(["a:failed", "b:scheduled"]);
    expect(sameTimeOn("2026-11-15T04:30:00.000Z", "2026-11-18", "Asia/Kolkata").toISOString()).toBe("2026-11-18T04:30:00.000Z");
    expect([...groupByDay([a, b], "UTC").keys()]).toEqual(["2026-11-15", "2026-11-20"]);
    expect(isUnscheduledDraft({ status: "draft", scheduledAt: null })).toBe(true);
    expect(isUnscheduledDraft({ status: "draft", scheduledAt: a.scheduledAt })).toBe(false);
  });
  test("upcoming stops at the last loaded page so a gap never reads as empty", () => {
    const now = +new Date("2026-11-15T00:00:00Z");
    const list = [
      { id: "1", status: "scheduled", scheduledAt: "2026-11-16T00:00:00Z" },
      { id: "2", status: "scheduled", scheduledAt: "2026-11-30T00:00:00Z" },
      { id: "3", status: "published", scheduledAt: "2026-11-17T00:00:00Z" },
      { id: "4", status: "scheduled", scheduledAt: "2026-11-01T00:00:00Z" },
    ];
    expect(upcomingOf(list, now, null).map((p) => p.id)).toEqual(["1", "2"]);
    expect(upcomingOf(list, now, "2026-11-20T00:00:00Z").map((p) => p.id)).toEqual(["1"]);
  });
});

const acct = (o: Partial<AccountState> = {}): AccountState => ({ id: "ig1", platform: "instagram", status: "connected", expiresAt: null, ...o });
const post = (o: Partial<AttentionPost> = {}): AttentionPost => ({
  status: "scheduled",
  scheduledAt: "2026-11-20T10:00:00.000Z",
  requireApproval: false,
  approved: false,
  review: null,
  format: "video",
  media: { status: "ready" },
  targets: [{ id: "t1", platform: "instagram", status: "pending", errorCode: null }],
  ...o,
});
const NOW = +new Date("2026-11-15T00:00:00Z");

describe("requires attention", () => {
  test("a clean booked post is just Scheduled; a dated draft is Draft", () => {
    expect(attentionFor(post(), [acct()], NOW)).toEqual([]);
    expect(displayStatus(post(), [])).toBe("scheduled");
    expect(displayStatus(post({ status: "draft" }), [])).toBe("draft");
    expect(DISPLAY_LABEL.attention).toBe("Requires attention");
  });
  test("disconnected, needs reconnect, missing and expiring accounts", () => {
    expect(attentionFor(post(), [acct({ status: "disconnected" })], NOW)[0].code).toBe("account_disconnected");
    expect(attentionFor(post(), [acct({ status: "needs_reconnect" })], NOW)[0].code).toBe("account_reconnect");
    expect(attentionFor(post(), [], NOW)[0].code).toBe("account_missing");
    // Runs out before the booked time (no refresh token): attention. After it: fine.
    expect(attentionFor(post(), [acct({ expiresAt: "2026-11-18T00:00:00Z" })], NOW)[0].code).toBe("account_expired");
    expect(attentionFor(post(), [acct({ expiresAt: "2026-12-18T00:00:00Z" })], NOW)).toEqual([]);
    // A pinned account wins over the platform default.
    const pinned = post({ accountIds: { t1: "ig2" } });
    expect(attentionFor(pinned, [acct(), acct({ id: "ig2", status: "disconnected" })], NOW)[0].code).toBe("account_disconnected");
    expect(displayStatus(post(), attentionFor(post(), [], NOW))).toBe("attention");
    // Accounts not known: no account guesses at all.
    expect(attentionFor(post(), null, NOW)).toEqual([]);
  });
  test("approval held, changes requested, media problems", () => {
    expect(attentionFor(post({ requireApproval: true }), [acct()], NOW).map((r) => r.code)).toEqual(["approval_pending"]);
    expect(attentionFor(post({ requireApproval: true, approved: true }), [acct()], NOW)).toEqual([]);
    expect(attentionFor(post({ requireApproval: true, review: { status: "changes_requested" } }), [acct()], NOW)[0].code).toBe("changes_requested");
    expect(attentionFor(post({ media: { status: "failed" } }), [acct()], NOW)[0].code).toBe("media_failed");
    expect(attentionFor(post({ format: "carousel", slideCount: 1 }), [acct()], NOW)[0].code).toBe("media_missing");
    expect(attentionFor(post({ format: "carousel", slideCount: 3 }), [acct()], NOW)).toEqual([]);
    expect(attentionFor(post({ format: "photo" }), [acct()], NOW)).toEqual([]); // slides not loaded: not judged
  });
  test("failed stays Failed, partial needs attention, published and publishing never do", () => {
    const failedT = [{ id: "t1", platform: "instagram", status: "failed", errorCode: "AUTH_EXPIRED" }];
    const f = post({ status: "failed", targets: failedT });
    expect(attentionFor(f, [acct()], NOW).map((r) => r.code)).toEqual(["target_failed"]);
    expect(displayStatus(f, attentionFor(f, [acct()], NOW))).toBe("failed");
    const p = post({ status: "partial", targets: [...failedT, { id: "t2", platform: "youtube", status: "published" }] });
    expect(displayStatus(p, attentionFor(p, [acct()], NOW))).toBe("attention");
    expect(attentionFor(post({ status: "published" }), [], NOW)).toEqual([]);
    expect(displayStatus(post({ status: "publishing" }), [])).toBe("publishing");
    // Stopped by the creator: not a platform failure.
    expect(attentionFor(post({ status: "failed", targets: [{ ...failedT[0], errorCode: "CANCELED" }] }), [acct()], NOW)).toEqual([]);
  });
});

describe("wiring kept", () => {
  const src = (f: string) => readFileSync(f, "utf8");
  test("calendar keeps the strings older rounds assert and gains the P2 parts", () => {
    const c = src("components/calendar/CalendarView.tsx");
    expect(c).toContain('isToday ? "glass lime-ring" : "card-glass bg-card/50 hairline"');
    expect(c).toContain('<AnimatedNumber value={weekCount} format="int" tier="main" id="calendar:week" />');
    expect(c).toContain('useTabMemory("calendar:view"');
    expect(c).toContain("<QuickActions />");
    expect(c).toContain("<MoveDialog");
    expect(c).not.toContain("transition-all");
    const q = src("components/calendar/QuickActions.tsx");
    for (const h of ['"/create"', '"/create/bulk"', '"/content?filter=draft"', '"/content?filter=scheduled"']) expect(q).toContain(h);
    const m = src("components/calendar/MoveDialog.tsx");
    expect(m).toContain("/check?at=");
    expect(m).toContain('e.code === "schedule_conflict"');
    expect(src("app/(studio)/calendar/page.tsx")).not.toContain("90 * 864e5");
    const s = src("components/posts/PostSheet.tsx");
    expect(s).toContain("/cancel`");
    expect(s).toContain("recoveryActions(");
    expect(src("components/shared/StatusBadge.tsx")).toContain('attention: { label: "Requires attention"');
    for (const f of ["CalendarView", "DayView", "MonthView", "UpcomingList", "ViewSwitch", "PostCard", "MoveDialog", "QuickActions", "DraftsTray"]) {
      const t = src(`components/calendar/${f}.tsx`);
      expect(t).not.toMatch(/[\u2013\u2014]/);
      expect(t).not.toContain("transition-all");
    }
  });
});
