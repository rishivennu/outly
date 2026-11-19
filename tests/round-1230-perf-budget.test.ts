/** R1230: performance budgets on the admin Startup speed read-out; R1227: every video asks only for metadata up front. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BUDGET, overBudget, verdict } from "../lib/perf/aggregate";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("R1230: budgets", () => {
  test("web.dev thresholds at p75; CLS compared x1000", () => {
    expect(BUDGET.lcp).toEqual({ good: 2500, poor: 4000 });
    expect(verdict("lcp", 2500)).toBe("good");
    expect(verdict("lcp", 2501)).toBe("needs work");
    expect(verdict("lcp", 4001)).toBe("poor");
    expect(verdict("cls", 92)).toBe("good");
    expect(verdict("cls", 260)).toBe("poor");
    expect(verdict("inp", 350)).toBe("needs work");
  });
  test("no budget, no samples: no verdict", () => {
    expect(verdict("hydrate", 5000)).toBeNull();
    expect(verdict("mwMs", 10)).toBeNull();
    expect(verdict("lcp", null)).toBeNull();
  });
  test("over budget lists only the metrics beyond good, in metric order", () => {
    expect(overBudget({ ttfb: 300, fcp: 1900, lcp: 2000, cls: 300, inp: null, hydrate: 9000 })).toEqual(["fcp", "cls"]);
    expect(overBudget({})).toEqual([]);
  });
  test("the admin page shows the word, not colour alone, and an Over budget column per version", () => {
    const page = src("app/admin/(panel)/perf/page.tsx");
    expect(page).toContain("verdict(m, s.p75)");
    expect(page).toContain('"Over budget"');
    expect(page).toContain("overBudget(v.p75)");
    expect(page).toContain("<span className={VERDICT_CLASS[v]}>{v}</span>");
  });
});

describe("R1227: video elements never preload whole files", () => {
  test("every <video> in the studio carries preload metadata or none", () => {
    for (const f of ["components/create/SavedDrafts.tsx", "components/review/ReviewPage.tsx", "components/create/VideoStage.tsx", "components/create/Previews.tsx", "components/inbox/VideoPreview.tsx", "components/shared/Thumb.tsx", "components/support/Answer.tsx", "components/create/FormatComposer.tsx"]) {
      const s = src(f);
      const tags = s.match(/<video\b[\s\S]*?>/g) ?? [];
      expect(tags.length).toBeGreaterThan(0);
      for (const t of tags) expect(t).toMatch(/preload="(metadata|none)"/);
    }
  });
});
