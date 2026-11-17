import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addDays, isoToZoned, todayIn, zonedToIso } from "../components/admin/blog/zoned";
import { CAL_STATUS, HISTORY_STATUS, agendaDays, dayLabel, delayedEvent, monthGrid, shiftMonth } from "../components/admin/blog/calendar-grid";
import type { BlogCalendarDay, BlogCalendarStatus, BlogHistoryStatus } from "../lib/blog/types";

// R1178: the blog calendar, history and "Approve and publish on ..." UI. Pure helpers are tested directly;
// the components get source checks, the way the R1175 blog tests check UI copy.
const ROOT = join(import.meta.dir, "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

const OWNED = [
  "app/admin/(panel)/blog/calendar/page.tsx",
  "app/admin/(panel)/blog/generate/page.tsx",
  "app/admin/(panel)/blog/review/[id]/page.tsx",
  "components/admin/blog/BlogCalendar.tsx",
  "components/admin/blog/TopicBacklog.tsx",
  "components/admin/blog/BlogHistory.tsx",
  "components/admin/blog/GenerateDesk.tsx",
  "components/admin/blog/TodayBlogCard.tsx",
  "components/admin/blog/ReviewDesk.tsx",
  "components/admin/blog/Library.tsx",
  "components/admin/blog/zoned.ts",
  "components/admin/blog/calendar-grid.ts",
  "tests/round-1178-calendar.test.ts",
];

describe("zonedToIso", () => {
  test("Asia/Kolkata is UTC+05:30 all year", () => {
    expect(zonedToIso("2026-11-20", "09:30", "Asia/Kolkata")).toBe("2026-11-20T04:00:00.000Z");
    expect(zonedToIso("2026-06-01", "00:00", "Asia/Kolkata")).toBe("2026-05-31T18:30:00.000Z");
  });
  test("UTC is unchanged", () => {
    expect(zonedToIso("2026-03-08", "23:59", "UTC")).toBe("2026-03-08T23:59:00.000Z");
  });
  test("America/New_York uses the offset of the target day across DST changes", () => {
    // DST starts 2026-03-08 02:00 and ends 2026-11-01 02:00.
    expect(zonedToIso("2026-03-07", "09:00", "America/New_York")).toBe("2026-03-07T14:00:00.000Z");
    expect(zonedToIso("2026-03-09", "09:00", "America/New_York")).toBe("2026-03-09T13:00:00.000Z");
    expect(zonedToIso("2026-10-31", "09:00", "America/New_York")).toBe("2026-10-31T13:00:00.000Z");
    expect(zonedToIso("2026-11-02", "09:00", "America/New_York")).toBe("2026-11-02T14:00:00.000Z");
  });
  test("a skipped spring hour lands just after the gap, an ambiguous autumn hour takes the first", () => {
    expect(zonedToIso("2026-03-08", "02:30", "America/New_York")).toBe("2026-03-08T07:30:00.000Z");
    expect(zonedToIso("2026-11-01", "01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
  });
  test("round trips through isoToZoned and rejects bad input", () => {
    for (const tz of ["Asia/Kolkata", "America/New_York", "UTC", "Europe/London"]) {
      expect(isoToZoned(zonedToIso("2026-07-04", "18:45", tz), tz)).toEqual({ date: "2026-07-04", time: "18:45" });
    }
    expect(() => zonedToIso("2026-7-4", "18:45", "UTC")).toThrow();
    expect(() => zonedToIso("2026-07-04", "", "UTC")).toThrow();
  });
  test("todayIn and addDays", () => {
    // 20:00 UTC on 16 Nov is already 17 Nov in India.
    expect(todayIn("Asia/Kolkata", Date.UTC(2026, 10, 16, 20, 0))).toBe("2026-11-17");
    expect(todayIn("UTC", Date.UTC(2026, 10, 16, 20, 0))).toBe("2026-11-16");
    expect(addDays("2026-11-17", 60)).toBe("2027-01-16");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

const days = (month: string, n: number): BlogCalendarDay[] => Array.from({ length: n }, (_, i) => ({ date: `${month}-${String(i + 1).padStart(2, "0")}`, skipped: false, scheduledRun: false, items: [] }));

describe("month grid", () => {
  test("Monday first, padded to whole weeks", () => {
    // 1 November 2026 is a Sunday: six empty cells before it.
    const g = monthGrid(days("2026-11", 30));
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g[0].slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(g[0][6]?.date).toBe("2026-11-01");
    expect(g.flat().filter(Boolean).length).toBe(30);
    expect(g.length).toBe(6);
    // 1 February 2027 is a Monday and the month is exactly four weeks.
    const f = monthGrid(days("2027-02", 28));
    expect(f.length).toBe(4);
    expect(f[0][0]?.date).toBe("2027-02-01");
    expect(monthGrid([])).toEqual([]);
  });
  test("shiftMonth crosses years", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-11", 0)).toBe("2026-11");
  });
  test("agenda keeps only days with something on them", () => {
    const d = days("2026-11", 5);
    d[1].scheduledRun = true;
    d[2].skipped = true;
    d[4].items = [{ kind: "post", id: "p", title: "T", status: "published", href: "/admin/blog/review/p", at: "2026-11-05T04:00:00.000Z", note: "" }];
    expect(agendaDays(d).map((x) => x.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-05"]);
  });
  test("day button label", () => {
    const d = days("2026-11", 17)[16];
    d.scheduledRun = true;
    d.items = [1, 2].map((i) => ({ kind: "job" as const, id: String(i), title: "x", status: "running" as const, href: "/admin/blog/generate", at: "", note: "" }));
    expect(dayLabel(d, "06:00")).toBe("17 November, 2 items, run at 06:00");
    expect(dayLabel({ ...d, items: d.items.slice(0, 1), scheduledRun: false, skipped: true }, "06:00", "2026-11-17")).toBe("17 November, today, 1 item, skipped");
  });
  test("delayedEvent only on a running job", () => {
    const ev = [{ stage: "draft1", status: "done", ms: 1, message: "", at: "" }, { stage: "draft2", status: "delayed", ms: 0, message: "Past 08:00", at: "" }];
    expect(delayedEvent({ status: "running", events: ev })?.message).toBe("Past 08:00");
    expect(delayedEvent({ status: "done", events: ev })).toBeNull();
    expect(delayedEvent({ status: "running", events: ev.slice(0, 1) })).toBeNull();
    expect(delayedEvent(null)).toBeNull();
  });
});

describe("status vocabulary", () => {
  const cal: BlogCalendarStatus[] = ["running", "delayed", "failed", "cancelled", "pending", "approved", "scheduled", "published", "rejected"];
  const hist: BlogHistoryStatus[] = ["running", "retrying", "delayed", "done", "failed", "cancelled"];
  test("every calendar status has its agreed text label", () => {
    expect(Object.keys(CAL_STATUS).sort()).toEqual([...cal].sort());
    expect(cal.map((s) => CAL_STATUS[s].label)).toEqual(["Generating", "Running late", "Failed", "Stopped", "Pending review", "Approved", "Scheduled", "Published", "Rejected"]);
  });
  test("every history status has its agreed text label", () => {
    expect(Object.keys(HISTORY_STATUS).sort()).toEqual([...hist].sort());
    expect(hist.map((s) => HISTORY_STATUS[s].label)).toEqual(["Running", "Retrying", "Running late", "Done", "Failed", "Stopped"]);
  });
});

describe("source checks", () => {
  test("the calendar page is real now", () => {
    const s = src("app/admin/(panel)/blog/calendar/page.tsx");
    expect(s).not.toContain("Unavailable");
    expect(s).toContain('requireAdmin("content")');
    expect(s).toContain("calendarMonth()");
    expect(s).toContain("backlogTopics()");
    // Server pages never import values from "use client" files except the components they render.
    expect(s).not.toMatch(/import \{[^}]*(CAL_STATUS|zonedToIso)[^}]*\} from "@\/components\/admin\/blog\/(BlogCalendar|TopicBacklog)"/);
  });
  test("no em or en dashes in any owned file", () => {
    for (const f of OWNED) expect({ f, dash: /[\u2013\u2014]/.test(src(f)) }).toEqual({ f, dash: false });
  });
  test("every Pill carries text, never colour alone", () => {
    for (const f of OWNED.filter((x) => x.endsWith(".tsx"))) {
      for (const m of src(f).matchAll(/<Pill\b[^>]*>([\s\S]*?)<\/Pill>/g)) expect({ f, text: m[1].trim().length > 0 }).toEqual({ f, text: true });
      expect({ f, selfClosing: /<Pill\b[^>]*\/>/.test(src(f)) }).toEqual({ f, selfClosing: false });
    }
  });
  test("scheduling copy says a person approves", () => {
    const cal = src("components/admin/blog/BlogCalendar.tsx");
    expect(cal).toContain("Approve and publish on ");
    expect(cal).toContain('action: "schedule"');
    expect(src("components/admin/blog/ReviewDesk.tsx")).toContain('act("unschedule")');
    expect(src("components/admin/blog/ReviewDesk.tsx")).toContain('role="alert"');
  });
  test("history polls only while a run is live and retries through the contract route", () => {
    const h = src("components/admin/blog/BlogHistory.tsx");
    expect(h).toContain("/api/admin/blog/history");
    expect(h).toContain("/retry`");
    expect(h).toContain("20_000");
    expect(src("components/admin/blog/GenerateDesk.tsx")).toContain("forDate");
    expect(src("components/admin/blog/TodayBlogCard.tsx")).toContain("Running late");
  });
});
