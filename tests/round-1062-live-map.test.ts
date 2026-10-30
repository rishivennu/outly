import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { agoLabel, buildLiveMap, clampTimeout, LIVE_DEFAULT_MIN, statusOf } from "../lib/live-map-core";
import { placePoint } from "../lib/geo-points";

const NOW = Date.parse("2026-10-30T10:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000);
const row = (id: string, min: number, country: string | null, city: string | null = null, via: string | null = "cloudflare") => ({
  id, name: `U ${id}`, email: `${id}@x.com`, lastSeenAt: ago(min), country, region: null, city, via, locAt: ago(60 * 24),
});

describe("admin live globe (1062)", () => {
  test("timeout only takes the offered values, else the site-wide 5 minutes", () => {
    expect(clampTimeout(10)).toBe(10);
    expect(clampTimeout("15")).toBe(15);
    for (const bad of [0, 1, 3, 61, "x", null, undefined, -5, 1e9]) expect(clampTimeout(bad)).toBe(LIVE_DEFAULT_MIN);
  });

  test("active inside the timeout, idle up to an hour, gone after", () => {
    expect(statusOf(ago(4.9), NOW, 5)).toBe("active");
    expect(statusOf(ago(5.1), NOW, 5)).toBe("idle");
    expect(statusOf(ago(12), NOW, 15)).toBe("active");
    expect(statusOf(ago(59), NOW, 5)).toBe("idle");
    expect(statusOf(ago(61), NOW, 5)).toBeNull();
    expect(statusOf(new Date(NOW + 10 * 60_000), NOW, 5)).toBeNull(); // clock from the future: ignored
    expect(statusOf("not a date", NOW, 5)).toBeNull();
  });

  test("groups by mapped city, falls back to the country centre, counts the unplaceable separately", () => {
    const m = buildLiveMap(
      [
        row("a", 1, "IN", "Bengaluru"),
        row("b", 3, "IN", "bengaluru"),
        row("c", 20, "IN", "Bengaluru"),
        row("d", 2, "IN", "Some Village"),
        row("e", 2, "IN", null),
        row("f", 1, null),
        row("g", 1, "IN", "Mumbai", "tor"),
        row("h", 90, "US", "Seattle"),
      ],
      NOW,
      5,
    );
    expect(m.active).toBe(6);
    expect(m.idle).toBe(1);
    expect(m.unplaced).toEqual({ active: 2, idle: 0 });
    const blr = m.places.find((p) => p.key === "IN|bengaluru")!;
    expect(blr.precision).toBe("city");
    expect([blr.active, blr.idle]).toEqual([2, 1]);
    expect(blr.people.map((p) => p.id)).toEqual(["a", "b", "c"]); // active first, newest first
    const india = m.places.find((p) => p.key === "IN")!;
    expect(india.precision).toBe("country");
    expect(india.city).toBeNull();
    expect(india.active).toBe(2);
    expect(m.places.some((p) => p.country === "US")).toBe(false); // seen 90 min ago: not on the globe
    expect(m.places[0].key).toBe("IN|bengaluru"); // busiest first
  });

  test("never exposes IP or coordinates finer than a rounded city centre", () => {
    const m = buildLiveMap([row("a", 1, "IN", "Hyderabad")], NOW, 5);
    const s = JSON.stringify(m);
    expect(s).not.toMatch(/"ip"|address/i);
    const p = m.places[0];
    expect(Math.round(p.lat * 10) / 10).toBe(p.lat);
    expect(Math.round(p.lng * 10) / 10).toBe(p.lng);
  });

  test("place table: accents and case fold, unknown country is null", () => {
    expect(placePoint("BR", "São Paulo")?.precision).toBe("city");
    expect(placePoint("in", "MUMBAI")?.precision).toBe("city");
    expect(placePoint("IN", "Nowhere")?.precision).toBe("country");
    expect(placePoint("ZZ", null)).toBeNull();
    expect(placePoint(null, "Mumbai")).toBeNull();
  });

  test("ago labels", () => {
    expect(agoLabel(ago(0.2), NOW)).toBe("just now");
    expect(agoLabel(ago(4), NOW)).toBe("4 min ago");
    expect(agoLabel(ago(120), NOW)).toBe("2 h ago");
  });

  test("API is admin-only (Users area), uncached, and the overview gates the card the same way", () => {
    const route = readFileSync("app/api/admin/live/route.ts", "utf8");
    expect(route).toMatch(/adminRoute\(\s*"users"/);
    expect(route).toContain("no-store");
    const page = readFileSync("app/admin/(panel)/page.tsx", "utf8");
    expect(page).toContain('can(admin.role, "users")');
    const q = readFileSync("lib/admin/live-map.ts", "utf8");
    expect(q).toContain("@sample.outly.test");
    const select = q.slice(q.indexOf("select:"), q.indexOf("},", q.indexOf("select:")));
    expect(select).not.toMatch(/ip|lat|lng/i); // only last-seen time and the approximate place are read
  });
});
