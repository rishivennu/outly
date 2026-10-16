/** Home "This week" pulse: week-over-week change, the Monday strip in the creator's zone, compact numbers. */
import { describe, expect, test } from "bun:test";
import { compact, pctChange, weekStrip } from "../lib/retention/pulse-core";
import { weekStart } from "../lib/retention/core";

describe("pulse", () => {
  test("pctChange", () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
    expect(pctChange(10, 0)).toBeNull();
  });
  test("compact", () => {
    expect(compact(999)).toBe("999");
    expect(compact(1234)).toBe("1.2K");
    expect(compact(12400)).toBe("12K");
    expect(compact(2_500_000)).toBe("2.5M");
  });
  test("weekStrip buckets by local day, Monday first", () => {
    const tz = "Asia/Kolkata";
    const now = new Date("2026-10-16T06:00:00Z"); // Fri 11:30 IST
    const mon = weekStart(now, tz);
    const pub = [new Date("2026-10-12T20:00:00Z") /* Tue 01:30 IST */, new Date("2026-10-16T05:00:00Z")];
    const sch = [new Date("2026-10-18T12:00:00Z")];
    const s = weekStrip(mon, now, tz, pub, sch);
    expect(s.map((d) => d.label)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(s.map((d) => d.date)).toEqual([12, 13, 14, 15, 16, 17, 18]);
    expect(s[0].published).toBe(0);
    expect(s[1].published).toBe(1);
    expect(s[4].isToday).toBe(true);
    expect(s[4].published).toBe(1);
    expect(s[3].isPast).toBe(true);
    expect(s[6].scheduled).toBe(1);
    expect(s[6].isPast).toBe(false);
  });
});
