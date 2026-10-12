import { describe, expect, test } from "bun:test";
import { dayPart, greetingFor } from "@/components/shared/Greeting";
import { cached, invalidate } from "@/lib/cache";

describe("time-based greeting", () => {
  test("day parts cover every hour", () => {
    expect(dayPart(4)).toBe("night");
    expect(dayPart(5)).toBe("morning");
    expect(dayPart(11)).toBe("morning");
    expect(dayPart(12)).toBe("afternoon");
    expect(dayPart(16)).toBe("afternoon");
    expect(dayPart(17)).toBe("evening");
    expect(dayPart(21)).toBe("evening");
    expect(dayPart(22)).toBe("night");
    expect(dayPart(0)).toBe("night");
  });
  test("greeting text", () => {
    expect(greetingFor(9, "Tej")).toBe("Good morning, Tej");
    expect(greetingFor(14)).toBe("Good afternoon");
    expect(greetingFor(19, "A")).toBe("Good evening, A");
    expect(greetingFor(2, "A")).toBe("Working late, A");
  });
});

describe("read cache", () => {
  test("single-flight: 100 concurrent callers trigger one load", async () => {
    let loads = 0;
    const load = async () => {
      loads++;
      await new Promise((r) => setTimeout(r, 20));
      return 42;
    };
    const out = await Promise.all(Array.from({ length: 100 }, () => cached("t:sf", 1000, load)));
    expect(loads).toBe(1);
    expect(out.every((v) => v === 42)).toBe(true);
  });
  test("TTL expiry reloads", async () => {
    let loads = 0;
    const load = async () => ++loads;
    expect(await cached("t:ttl", 10, load)).toBe(1);
    expect(await cached("t:ttl", 10, load)).toBe(1);
    await new Promise((r) => setTimeout(r, 25));
    expect(await cached("t:ttl", 10, load)).toBe(2);
  });
  test("invalidate by prefix", async () => {
    let loads = 0;
    const load = async () => ++loads;
    await cached("t:inv:a", 60_000, load);
    invalidate("t:inv:");
    expect(await cached("t:inv:a", 60_000, load)).toBe(2);
  });
  test("errors are not cached", async () => {
    let n = 0;
    const load = async () => {
      if (++n === 1) throw new Error("boom");
      return "ok";
    };
    await expect(cached("t:err", 60_000, load)).rejects.toThrow("boom");
    expect(await cached("t:err", 60_000, load)).toBe("ok");
  });
});
