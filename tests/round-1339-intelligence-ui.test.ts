/**
 * R1339: UI and UX round on the Intelligence entitlements surfaces.
 *
 * Pure: the baselines card shows exactly one notice (cold start outranks "nothing measured", loading and error never
 * overlap), re-reads on its own only while a backfill is running and only BACKFILL_REFETCH_MS.length times, and tells
 * the creator what will happen next. Source pins: the consent row is never blank (loading and failed states, a retry),
 * uses generated ids and 44 px targets; the upgrade button is 44 px; the admin AI Management page has five titled,
 * anchored areas with jump links and a refresh control, and shows the 402 denials once.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BACKFILL_REFETCH_MS, backfillRunning, baselinesNotice, baselinesRefetchDelay, coldStartDetail } from "../lib/intelligence/backfill-core";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("R1339 baselines card state, pure", () => {
  test("one notice at a time: cold start wins over empty, data wins over error, loading only before data", () => {
    expect(baselinesNotice({ data: null, error: null })).toBe("loading");
    expect(baselinesNotice({ data: null, error: "nope" })).toBe("error");
    expect(baselinesNotice({ data: { coldStart: true, platforms: [] }, error: null })).toBe("cold-start");
    expect(baselinesNotice({ data: { coldStart: true, platforms: [1] }, error: null })).toBe("cold-start");
    expect(baselinesNotice({ data: { coldStart: false, platforms: [] }, error: null })).toBe("empty");
    expect(baselinesNotice({ data: { platforms: [] }, error: "stale error from before" })).toBe("empty");
    expect(baselinesNotice({ data: { coldStart: false, platforms: [1] }, error: null })).toBeNull();
  });

  test("re-reads only while a backfill runs, early then patient, then stops", () => {
    expect(BACKFILL_REFETCH_MS).toEqual([20_000, 60_000]);
    expect(backfillRunning("kicked")).toBe(true);
    expect(backfillRunning("locked")).toBe(true);
    for (const v of ["fresh", "no-posts", "not-entitled", null, undefined] as const) expect(backfillRunning(v)).toBe(false);
    expect(baselinesRefetchDelay({ coldStart: true, backfill: "kicked" }, 0)).toBe(20_000);
    expect(baselinesRefetchDelay({ coldStart: true, backfill: "locked" }, 1)).toBe(60_000);
    expect(baselinesRefetchDelay({ coldStart: true, backfill: "kicked" }, 2)).toBeNull();
    expect(baselinesRefetchDelay({ coldStart: false, backfill: "kicked" }, 0)).toBeNull();
    expect(baselinesRefetchDelay({ coldStart: true, backfill: "fresh" }, 0)).toBeNull();
    expect(baselinesRefetchDelay({ coldStart: true, backfill: "no-posts" }, 0)).toBeNull();
    expect(baselinesRefetchDelay(null, 0)).toBeNull();
  });

  test("the cold-start detail says what happens next and never promises a number", () => {
    expect(coldStartDetail("kicked", 0)).toContain("checks again in a moment");
    expect(coldStartDetail("locked", 1)).toContain("checks again shortly");
    expect(coldStartDetail("kicked", 2)).toContain("Come back in a few minutes");
    expect(coldStartDetail("no-posts", 0)).toContain("first published post");
    expect(coldStartDetail("fresh", 0)).toBe("");
    expect(coldStartDetail(null, 0)).toBe("");
    for (const v of ["kicked", "locked", "no-posts"] as const) expect(coldStartDetail(v, 0)).not.toMatch(/\d/);
  });
});

describe("R1339 source pins", () => {
  test("the baselines card renders one notice and re-reads through the pure helpers", () => {
    const card = read("components/intelligence/PersonalBaselines.tsx");
    expect(card).toContain("baselinesNotice({ data, error })");
    expect(card).toContain("baselinesRefetchDelay(data, attempt)");
    expect(card).toContain("coldStartDetail(data.backfill, attempt)");
    expect(card).toContain('notice === "empty"');
    expect(card).not.toContain("fills in on your next visit");
    expect(card).not.toContain("{data && !data.platforms.length && (");
  });

  test("the consent row is never blank: loading and failed states, retry, generated ids, 44 px targets", () => {
    const row = read("components/intelligence/SharingRow.tsx");
    expect(row).not.toContain("return null");
    expect(row).toContain("Loading your sharing setting");
    expect(row).toContain('aria-busy="true"');
    expect(row).toContain("could not be read just now. Nothing has changed.");
    expect(row).toContain("Try again");
    expect(row).toContain("useId()");
    expect(row).not.toContain('"intel-sharing-label"');
    expect(row).not.toContain('"intel-sharing-hint"');
    expect(row).toContain("before:-inset-y-2");
    expect(row).toContain("before:content-['']");
    expect(count(row, "min-h-11")).toBeGreaterThanOrEqual(5);
    expect(row).not.toContain("py-1 font-medium");
  });

  test("the upgrade call to action is 44 px tall", () => {
    const up = read("components/intelligence/IntelligenceUpgrade.tsx");
    expect(up).toContain("min-h-11");
    expect(up).not.toContain("h-10 items-center");
  });

  test("the admin page has five titled, anchored areas with jump links, a refresh control and the denials once", () => {
    const page = read("app/admin/(panel)/intelligence/management/page.tsx");
    for (const id of ["access", "consent", "shared", "personal", "privacy"]) expect(page).toContain(`<Area id="${id}">`);
    expect(count(page, "</Area>")).toBe(5);
    expect(page).toContain('aria-label="Sections of this page"');
    expect(page).toContain("href={`#${x.id}`}");
    expect(page).toContain("scroll-mt-24");
    expect(page).toContain("<RefreshButton total={a.users}");
    expect(count(page, 'label="Entitlement checks failed"')).toBe(1);
    expect(page).not.toContain('label="Unauthorized attempts"');
    expect(page).toContain('label="Retention"');
    expect(page).toContain('href="#access"');
    expect(page).not.toContain("mb-4 grid");
    expect(page).not.toMatch(/INR|₹/);
  });
});
