import { describe, expect, test } from "bun:test";
import { fromTzParts, partsInTz } from "@/lib/client/tz";

const local = (d: Date, tz: string) => {
  const p = partsInTz(d, tz);
  return `${p.y}-${p.m}-${p.d} ${p.h}:${String(p.min).padStart(2, "0")}`;
};

describe("C25 fromTzParts across DST", () => {
  test("a wall clock time in the spring gap always moves forward by the gap", () => {
    expect(local(fromTzParts(2026, 3, 8, 2, 30, "America/New_York"), "America/New_York")).toBe("2026-3-8 3:30");
    expect(local(fromTzParts(2026, 3, 29, 1, 30, "Europe/London"), "Europe/London")).toBe("2026-3-29 2:30");
    expect(local(fromTzParts(2026, 10, 4, 2, 15, "Australia/Lord_Howe"), "Australia/Lord_Howe")).toBe("2026-10-4 2:45");
  });

  test("a repeated autumn hour picks the first occurrence", () => {
    expect(fromTzParts(2026, 10, 25, 1, 30, "Europe/London").toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(fromTzParts(2026, 11, 1, 1, 30, "America/New_York").toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  test("ordinary times round trip exactly, including odd offsets", () => {
    expect(fromTzParts(2026, 11, 4, 12, 0, "Asia/Kolkata").toISOString()).toBe("2026-11-04T06:30:00.000Z");
    expect(fromTzParts(2026, 1, 1, 0, 0, "Asia/Kathmandu").toISOString()).toBe("2025-12-31T18:15:00.000Z");
    expect(fromTzParts(2026, 4, 5, 3, 0, "Pacific/Chatham").toISOString()).toBe("2026-04-04T13:15:00.000Z");
    expect(fromTzParts(2026, 1, 1, 0, 0, "UTC").toISOString()).toBe("2026-01-01T00:00:00.000Z");
    for (const tz of ["America/New_York", "Europe/London", "Asia/Kolkata", "Australia/Sydney"]) {
      for (let h = 0; h < 24; h += 5) expect(local(fromTzParts(2026, 7, 15, h, 10, tz), tz)).toBe(`2026-7-15 ${h}:10`);
    }
  });
});
