import { describe, expect, test } from "bun:test";
import { cleanItems, shouldShowUpdate, UPDATE_DEFAULT, UPDATE_LIMITS } from "@/lib/updates";

const n = { ...UPDATE_DEFAULT, id: "v2", publishedAt: "2026-10-16T00:00:00.000Z" };

describe("update notice", () => {
  test("shows once to members who joined before it went out", () => {
    expect(shouldShowUpdate(n, null, "2026-09-01T00:00:00.000Z")).toBe(true);
    expect(shouldShowUpdate(n, "v2", "2026-09-01T00:00:00.000Z")).toBe(false);
  });
  test("a new publish shows again to people who closed the old one", () => {
    expect(shouldShowUpdate(n, "v1", "2026-09-01T00:00:00.000Z")).toBe(true);
  });
  test("new sign-ups skip it", () => {
    expect(shouldShowUpdate(n, null, "2026-10-17T00:00:00.000Z")).toBe(false);
  });
  test("off or empty never shows", () => {
    expect(shouldShowUpdate({ ...n, on: false }, null, null)).toBe(false);
    expect(shouldShowUpdate({ ...n, items: ["  "], body: " " }, null, null)).toBe(false);
  });
  test("cleanItems trims, drops blanks and caps", () => {
    const out = cleanItems(["  a   b ", "", "x".repeat(500), ...Array(20).fill("y")]);
    expect(out[0]).toBe("a b");
    expect(out[1].length).toBe(UPDATE_LIMITS.item);
    expect(out.length).toBe(UPDATE_LIMITS.items);
  });
  test("default copy has no emoji or em dashes", () => {
    const all = [UPDATE_DEFAULT.title, UPDATE_DEFAULT.body, ...UPDATE_DEFAULT.items].join(" ");
    expect(all).not.toMatch(/\u2014|\p{Extended_Pictographic}/u);
  });
});
