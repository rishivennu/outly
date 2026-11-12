/** 1142: Home opens faster: stale-while-revalidate numbers, a shorter card budget, a quicker entrance. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cachedStale, invalidate } from "../lib/cache";
import { stagger } from "../components/dashboard/motion";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("1142 stale-while-revalidate", () => {
  test("a stale copy answers at once while one background read replaces it", async () => {
    let n = 0;
    const load = async () => (await wait(30), ++n);
    expect(await cachedStale("t1142:a", 10, 10_000, load)).toBe(1);
    await wait(20); // past fresh, inside stale
    const t0 = Date.now();
    const [a, b] = await Promise.all([cachedStale("t1142:a", 10, 10_000, load), cachedStale("t1142:a", 10, 10_000, load)]);
    expect(Date.now() - t0).toBeLessThan(25); // did not wait on the 30 ms read
    expect([a, b]).toEqual([1, 1]);
    await wait(50);
    expect(await cachedStale("t1142:a", 10_000, 10_000, load)).toBe(2);
    expect(n).toBe(2); // one refresh, not two
  });
  test("past the stale window, or after invalidate, the caller waits for fresh", async () => {
    let n = 0;
    const load = async () => ++n;
    await cachedStale("t1142:b", 5, 10, load);
    await wait(20);
    expect(await cachedStale("t1142:b", 5, 10, load)).toBe(2);
    invalidate("t1142:b");
    expect(await cachedStale("t1142:b", 5, 10_000, load)).toBe(3);
  });
});

describe("1142 Home budgets and motion", () => {
  test("optional cards wait 1.5 s at most; the numbers keep their own budget", () => {
    const s = readFileSync("app/(studio)/home/page.tsx", "utf8");
    expect(s).toContain("const CARD_MS = 1500;");
    expect(s).toContain("soft(getPulse(user.id, 7, accountIds), PULSE_MS");
    expect(readFileSync("lib/dashboard/pulse.ts", "utf8")).toContain("cachedStale(");
  });
  test("every card has settled by about 0.6 s, however many there are", () => {
    expect(stagger(0.62, 30)).toBe(1);
    expect(stagger(0.62, 0)).toBe(1);
    expect(stagger(0, 0)).toBe(0);
  });
  test("ensurePlans: one round trip in the common case, shared by callers at the same moment", () => {
    const s = readFileSync("lib/billing/plans.ts", "utf8");
    expect(s).toContain("ensuring ??= ensurePlansNow()");
    expect(s).toContain("db.setting.count({ where: { key: { in: MIGRATION_KEYS } } })");
  });
});
