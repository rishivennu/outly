import { describe, expect, test } from "bun:test";
import { soft, withBudget } from "@/lib/budget";
import { chunkScript, isChunkError } from "@/lib/client/chunk-reload";

describe("soft (1079)", () => {
  test("answers the work when it is in time", async () => {
    expect(await soft(Promise.resolve(7), 50, null, "t")).toBe(7);
  });
  test("answers the fallback when the work is late", async () => {
    const slow = new Promise<number>((r) => setTimeout(() => r(1), 200));
    expect(await soft(slow, 20, "late", "t")).toBe("late");
  });
  test("answers the fallback when the work fails", async () => {
    expect(await soft(Promise.reject(new Error("db down")), 50, [null, null] as const, "t")).toEqual([null, null]);
  });
  test("withBudget still answers null when late", async () => {
    expect(await withBudget(new Promise((r) => setTimeout(r, 200)), 10)).toBeNull();
  });
});

describe("chunk reload (1079)", () => {
  test("spots the errors a missing build chunk throws", () => {
    expect(isChunkError(Object.assign(new Error("Loading chunk 812 failed."), { name: "ChunkLoadError" }))).toBe(true);
    expect(isChunkError(new Error("Loading CSS chunk app-layout failed"))).toBe(true);
    expect(isChunkError(new TypeError("Failed to fetch dynamically imported module: https://www.outlly.com/_next/static/chunks/a.js"))).toBe(true);
    expect(isChunkError(new TypeError("Importing a module script failed."))).toBe(true);
  });
  test("leaves ordinary errors alone", () => {
    expect(isChunkError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkError(null)).toBe(false);
  });
  test("the head script is valid JavaScript", () => {
    expect(() => new Function(chunkScript)).not.toThrow();
  });
});
