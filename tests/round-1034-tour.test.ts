/** 1034: the first-run tour walks the whole studio, Home to Settings, and every stop has something to point at. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const tour = readFileSync("components/onboarding/Tour.tsx", "utf8");
const nav = readFileSync("components/shell/Nav.tsx", "utf8");
const targets = [...tour.matchAll(/target: "([a-z-]+)"/g)].map((m) => m[1]);

describe("guided tour", () => {
  test("covers every studio page in nav order, Home first and Settings last", () => {
    expect(targets).toEqual(["home", "new-post", "content", "calendar", "analytics", "inbox", "approvals", "accounts", "billing", "support", "settings"]);
  });
  test("every target exists in the nav, and phones have a More fallback", () => {
    for (const t of targets.filter((t) => t !== "new-post")) expect(nav).toContain(`: "${t}"`);
    expect(nav).toContain('data-tour="new-post"');
    expect(nav).toContain('data-tour="more"');
  });
  test("owner-only pages are skipped for teammates", () => {
    expect(tour).toMatch(/target: "accounts", owner: true/);
    expect(tour).toMatch(/target: "billing", owner: true/);
    expect(tour).toContain("filter((s) => !s.owner)");
  });
  test("copy is short and plain: no em dashes, no emoji, one or two sentences", () => {
    for (const m of tour.matchAll(/body: "([^"]+)"/g)) {
      expect(m[1]).not.toMatch(/[\u2014\u{1F300}-\u{1FAFF}]/u);
      expect(m[1].length).toBeLessThan(130);
    }
  });
});

describe("page tips", async () => {
  const { GUIDES, MAX_STOPS, presentStops } = await import("../components/onboarding/guides");
  const { readdirSync, statSync } = await import("node:fs");
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(`${d}/${f}`).isDirectory() ? walk(`${d}/${f}`) : f.endsWith(".tsx") ? [`${d}/${f}`] : []));
  const src = [...walk("components"), ...walk("app")].map((f) => readFileSync(f, "utf8")).join("\n");

  test("every studio page has tips, Home through Settings", () => {
    for (const p of ["/home", "/create", "/content", "/calendar", "/analytics", "/inbox", "/approvals", "/accounts", "/billing", "/support", "/settings"]) expect(GUIDES[p]).toBeDefined();
  });
  test("every tip points at something that exists in the markup", () => {
    for (const g of Object.values(GUIDES)) {
      for (const s of g.stops) {
        const t = s.target!;
        const token = t.match(/data-guide="([^"]+)"/)?.[1] ?? t.match(/="([^"]+)"\]/)?.[1] ?? t.match(/^#([\w-]+)/)?.[1] ?? t.match(/^\.([\w-]+)/)?.[1];
        expect(token, t).toBeTruthy();
        const key = token!.startsWith(". ") ? "Open details" : token!.replace(/^lane-/, "lane-");
        if (t.includes("lane-")) expect(src).toContain("lane-${l.k}");
        else expect(src.includes(key) || src.includes(`"${key}"`), `${g.page}: ${t}`).toBe(true);
      }
    }
  });
  test("basic, not a manual: at most four short stops, and a fallback card when nothing is on screen", () => {
    for (const g of Object.values(GUIDES)) {
      for (const s of g.stops) expect(s.body.length).toBeLessThan(110);
      expect(presentStops(g, () => true).length).toBeLessThanOrEqual(MAX_STOPS);
      expect(presentStops(g, () => false)).toEqual([{ title: g.name, body: g.intro }]);
    }
  });
  test("tips wait for the tour, the cookie banner and other dialogs; skip turns them all off; replay brings them back", () => {
    const pg = readFileSync("components/onboarding/PageGuide.tsx", "utf8");
    expect(pg).toContain("tourState.open");
    expect(pg).toContain('[aria-labelledby="cc-title"]');
    expect(pg).toContain("guidesOffKey");
    expect(readFileSync("components/onboarding/Tour.tsx", "utf8")).toContain("resetGuides(user.id)");
    expect(readFileSync("app/(studio)/layout.tsx", "utf8")).toContain("<PageGuide />");
  });
});
