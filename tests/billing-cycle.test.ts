import { describe, expect, test } from "bun:test";
import { hasYearly, priceFor, yearlyBase, yearlySaving } from "../lib/billing/cycle";
import { normalizeDisplay } from "../lib/billing/display";

const creator = { priceMinor: 49900, currency: "INR", interval: "month", yearlyMinor: 0, prices: {} as Record<string, number> };

describe("yearly pricing", () => {
  test("automatic yearly = monthly x (12 - free months)", () => {
    expect(yearlyBase(creator, 2)).toBe(499000);
    expect(yearlyBase(creator, 0)).toBe(598800);
  });
  test("an admin-set yearly price wins", () => {
    expect(yearlyBase({ ...creator, yearlyMinor: 450000 }, 2)).toBe(450000);
  });
  test("free and already-yearly plans have no yearly switch", () => {
    expect(hasYearly({ priceMinor: 0, interval: "month" }, true)).toBe(false);
    expect(hasYearly({ priceMinor: 100, interval: "year" }, true)).toBe(false);
    expect(hasYearly(creator, false)).toBe(false);
    expect(hasYearly(creator, true)).toBe(true);
  });
  test("priceFor: base currency is exact, monthly is unchanged", () => {
    expect(priceFor(creator, "INR", "year", 2)).toMatchObject({ priceMinor: 499000, currency: "INR", interval: "year" });
    expect(priceFor(creator, "INR", "month", 2)).toMatchObject({ priceMinor: 49900, interval: "month" });
  });
  test("priceFor: other currencies scale the local monthly price and round cleanly", () => {
    const usdMonth = priceFor(creator, "USD", "month", 2).priceMinor;
    const usdYear = priceFor(creator, "USD", "year", 2);
    expect(usdYear.interval).toBe("year");
    expect(usdYear.priceMinor % 100).toBe(99);
    expect(Math.abs(usdYear.priceMinor - usdMonth * 10)).toBeLessThan(100);
    const set = priceFor({ ...creator, prices: { USD: 599 } }, "USD", "year", 2);
    expect(set.priceMinor).toBe(5999);
  });
  test("saving percent", () => {
    expect(yearlySaving(49900, 499000)).toBe(17);
    expect(yearlySaving(0, 0)).toBe(0);
  });
  test("display config normalises junk", () => {
    expect(normalizeDisplay({ cardStyle: "nope", yearly: "yes", freeMonths: 99 })).toEqual({ cardStyle: "live", yearly: true, freeMonths: 2 });
    expect(normalizeDisplay({ cardStyle: "glass", yearly: false, freeMonths: 3 })).toEqual({ cardStyle: "glass", yearly: false, freeMonths: 3 });
  });
});
