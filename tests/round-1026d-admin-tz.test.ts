import { describe, expect, test } from "bun:test";
import { fmtDate } from "@/components/admin/ui";

// Admin dates must render the same text on the Vercel server (UTC) and in the browser,
// otherwise React throws hydration errors #425/#422. They are pinned to India time.
describe("admin dates are time-zone pinned", () => {
  test("fmtDate with time shows India time regardless of process TZ", () => {
    expect(fmtDate("2026-10-26T20:00:00Z", true)).toMatch(/27 Oct.*1:30/);
  });
  test("fmtDate date-only rolls over at India midnight", () => {
    expect(fmtDate("2026-10-26T19:00:00Z")).toMatch(/27 Oct 2026/);
  });
  test("null is Never", () => {
    expect(fmtDate(null)).toBe("Never");
  });
});
