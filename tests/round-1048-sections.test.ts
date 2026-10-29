import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { clockAfter6, DAYS, EVENING_MIN, eveningWeek } from "../lib/marketing/evenings";
import { timeSaved } from "../lib/marketing/time-saved";

describe("1048 Your evenings", () => {
  test("clockAfter6 formats and caps at midnight", () => {
    expect(clockAfter6(0)).toBe("6:00 pm");
    expect(clockAfter6(144)).toBe("8:24 pm");
    expect(clockAfter6(EVENING_MIN)).toBe("12:00 am");
    expect(clockAfter6(9999)).toBe("12:00 am");
    expect(clockAfter6(-5)).toBe("6:00 pm");
  });

  for (const i of [
    { videos: 5, platforms: 3, byHand: 12 },
    { videos: 1, platforms: 1, byHand: 3 },
    { videos: 30, platforms: 3, byHand: 45 },
    { videos: 9, platforms: 2, byHand: 21 },
  ]) {
    test(`week adds up for ${JSON.stringify(i)}`, () => {
      const w = eveningWeek(i);
      const t = timeSaved(i);
      expect(w.map((d) => d.day)).toEqual([...DAYS]);
      expect(w.reduce((s, d) => s + d.videos, 0)).toBe(i.videos);
      expect(w.reduce((s, d) => s + d.outllyMin, 0)).toBe(t.outllyWeek);
      expect(Math.abs(w.reduce((s, d) => s + d.handMin, 0) - t.manualWeek)).toBeLessThanOrEqual(4);
      if (i.platforms * i.byHand >= 4) for (const d of w) expect(d.outllyMin).toBeLessThanOrEqual(d.handMin);
    });
  }

  test("extra videos spread Mon, Wed, Fri first", () => {
    const w = eveningWeek({ videos: 3, platforms: 3, byHand: 12 });
    expect(w.filter((d) => d.videos).map((d) => d.day)).toEqual(["Mon", "Wed", "Fri"]);
  });
});

describe("1048 sections wiring", () => {
  const css = readFileSync("app/globals.css", "utf8");
  test("receipt, evenings and AI orb styles respect reduced motion", () => {
    for (const c of [".rcpt", ".ev-board", ".ai-orb", ".ai-shimmer"]) expect(css).toContain(c);
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*\.ai-orb/);
  });
  test("inbox sparkle reports busy while thinking", () => {
    const src = readFileSync("components/inbox/InboxView.tsx", "utf8");
    expect(src).toContain("ai-orb");
    expect(src).toContain("aria-busy");
  });
});

describe("1048 invoice PDF is owner-only", () => {
  test("a teammate (actor set) never passes the owner check", () => {
    const src = readFileSync("app/api/billing/invoices/[number]/route.ts", "utf8");
    expect(src).toMatch(/!user\.actor && user\.id === inv\?\.userId/);
    expect(src).not.toContain("user?.id === inv.userId ||");
  });
});
