/**
 * R1238: the Content Intelligence page. The words the cards show for a missing, thin or impossible number are pure
 * (components/intelligence/view-core.ts) and tested here against the engine's own types, plus source pins for the
 * nav entry, the sections the view renders and the house rules.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MAIN, ANIM, pageTitle } from "../components/shell/nav-items";
import { ANIMATED } from "../components/icons/animated/index";
import { MIN_SAMPLE, SIGNAL_MIN_LIFT, type Evidence, type FormatGroup, type MetricStat } from "../lib/intelligence/core";
import {
  CONFIDENCE_WORD, DAY_OPTIONS, attentionEmptyText, bestGroups, byPlatform, confidenceNote, createHref, emptyStateText,
  engagementCell, evidenceLine, formatLabel, hasEnoughPosts, liftWord, metricCell, overviewUrl, platformLabel,
  statusWord, viewShareCell, workingEmptyText,
} from "../components/intelligence/view-core";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const stat = (o: Partial<MetricStat> = {}): MetricStat => ({ metric: "views", availability: "available", median: 1200, n: 5, ...o });
const group = (o: Partial<FormatGroup> = {}): FormatGroup => ({
  platform: "instagram",
  format: "video",
  n: 6,
  status: "ok",
  primary: "views",
  metrics: [stat()],
  engagementRate: 4.5,
  postShare: 50,
  viewShare: 60,
  top: [{ id: "t-aaaaaa1", value: 2000 }],
  ...o,
});
const evidence = (o: Partial<Evidence> = {}): Evidence => ({ metric: "views", value: 1200, baseline: 800, unit: "count", lift: 50, n: 6, baselineN: 5, period: "Last 28 days", ...o });

describe("R1238 a gap is always a word, never a zero", () => {
  test("a metric the platform does not report says who does not report it", () => {
    expect(metricCell(stat({ availability: "unavailable", median: null }), "tiktok", "video")).toBe("Not provided by TikTok");
    expect(metricCell(stat({ availability: "unsupported", median: null }), "youtube", "carousel")).toBe("Not possible for a carousel on YouTube");
    expect(metricCell(stat({ median: null }), "instagram", "video")).toBe("No numbers yet");
    expect(metricCell(undefined, "instagram", "video")).toBe("Not tracked for this objective");
    for (const s of [stat({ availability: "unavailable", median: null }), stat({ availability: "unsupported", median: null }), stat({ median: null })]) {
      expect(metricCell(s, "instagram", "video")).not.toMatch(/\b0\b/);
    }
  });
  test("a real zero is still shown as a number", () => {
    expect(metricCell(stat({ availability: "zero", median: 0 }), "instagram", "video")).toBe("0");
  });
  test("a thin or empty group says how many posts are missing, a ranked one says it is ranked", () => {
    expect(statusWord(group({ status: "insufficient", n: 1 }))).toBe(`Not enough posts yet: 1 of the ${MIN_SAMPLE} needed`);
    expect(statusWord(group({ status: "unavailable", platform: "linkedin" }))).toBe("Numbers not provided by LinkedIn");
    expect(statusWord(group())).toBe("Ranked");
  });
  test("engagement rate and view share name the platform when it gives neither", () => {
    expect(engagementCell(group())).toBe("4.50%");
    expect(engagementCell(group({ engagementRate: null, status: "unavailable", platform: "x" }))).toBe("Not provided by X");
    expect(engagementCell(group({ engagementRate: null, status: "insufficient" }))).toBe("No numbers yet");
    expect(viewShareCell(group({ viewShare: null, platform: "linkedin" }))).toBe("Views not provided by LinkedIn");
    expect(viewShareCell(group())).toBe("60% of Instagram views");
  });
});

describe("R1238 claims carry their numbers", () => {
  test("evidence reads as value, baseline, sample and period", () => {
    expect(evidenceLine(evidence())).toBe("Median 1.2K views vs 800 across the 5 posts before, 6 posts, Last 28 days");
    expect(evidenceLine(evidence({ unit: "index", value: 130, baseline: 100, baselineN: 1, metric: "comments" }))).toBe("Median index 130 comments vs 100 for your usual posts (1 post), 6 posts, Last 28 days");
  });
  test("a lift is a direction word plus a percent, never a colour alone", () => {
    expect(liftWord(42.4)).toBe("Up 42%");
    expect(liftWord(-42.4)).toBe("Down 42%");
  });
  test("confidence is a word first, from the engine's own thresholds", () => {
    expect(confidenceNote(2).level).toBe("low");
    expect(confidenceNote(6).level).toBe("medium");
    expect(confidenceNote(20).level).toBe("high");
    expect(confidenceNote(20).text).toContain(CONFIDENCE_WORD.high);
    expect(confidenceNote(1).text).toContain("1 post.");
  });
  test("the empty states say exactly what is missing", () => {
    expect(hasEnoughPosts(MIN_SAMPLE)).toBe(true);
    expect(hasEnoughPosts(MIN_SAMPLE - 1)).toBe(false);
    const t = emptyStateText(1, 28);
    expect(t).toContain(`at least ${MIN_SAMPLE} published posts`);
    expect(t).toContain("last 28 days");
    expect(t).toContain("and you have 1");
    expect(t).toContain("2 more posts");
    expect(workingEmptyText).toContain(`${SIGNAL_MIN_LIFT}%`);
    expect(attentionEmptyText).toContain(`${SIGNAL_MIN_LIFT}%`);
  });
});

describe("R1238 grouping and links", () => {
  test("platforms keep their own rows and are never merged", () => {
    const rows = byPlatform([group(), group({ format: "carousel" }), group({ platform: "youtube" })]);
    expect(rows.map((r) => r.platform)).toEqual(["instagram", "youtube"]);
    expect(rows[0].groups).toHaveLength(2);
  });
  test("only ranked groups with best posts are offered, each with its own metric", () => {
    const best = bestGroups([group(), group({ status: "insufficient" }), group({ platform: "youtube", top: [] })]);
    expect(best).toHaveLength(1);
    expect(best[0]).toMatchObject({ platform: "instagram", format: "video", metric: "views" });
  });
  test("Create from this only exists when the recommendation has an id", () => {
    expect(createHref("rec:format:instagram:video:views")).toBe("/create?rec=rec%3Aformat%3Ainstagram%3Avideo%3Aviews");
    expect(createHref(null)).toBeNull();
    expect(createHref("")).toBeNull();
  });
  test("the API is called with the windows the route accepts", () => {
    expect(DAY_OPTIONS).toEqual([7, 28, 90]);
    expect(overviewUrl(7, "sales", "acc1")).toBe("/api/intelligence/overview?days=7&objective=sales&account=acc1");
    expect(overviewUrl(28, null, null)).toBe("/api/intelligence/overview?days=28");
  });
  test("platform and format names come from the shared vocabularies", () => {
    expect(platformLabel("youtube")).toBe("YouTube");
    expect(platformLabel("mystery")).toBe("mystery");
    expect(formatLabel("carousel")).toBe("Carousel");
    expect(formatLabel("mystery")).toBe("mystery");
  });
});

describe("R1238 nav", () => {
  test("Intelligence sits directly after Analytics in the sidebar, and the phone tab bar is untouched", () => {
    const hrefs = MAIN.map((m) => m.href);
    const a = hrefs.indexOf("/analytics");
    expect(hrefs[a + 1]).toBe("/intelligence");
    expect(MAIN[a + 1].label).toBe("Intelligence");
    const nav = read("components/shell/Nav.tsx");
    expect(nav).toContain('const TABS = ["/home", "/create", "/calendar", "/inbox", "/analytics"]');
    expect(read("lib/client/tab-bar.ts")).not.toContain("/intelligence");
  });
  test("it has a rail icon, a phone title and a session gate", () => {
    expect(ANIM["/intelligence"]).toBe("intelligence");
    expect(ANIMATED.intelligence).toBeDefined();
    expect(pageTitle("/intelligence")).toBe("Intelligence");
    expect(read("middleware.ts")).toContain('"/intelligence"');
    expect(read("lib/hosts.ts")).toContain('"/intelligence"');
  });
});

describe("R1238 the page and its sections", () => {
  const view = read("components/intelligence/IntelligenceView.tsx");
  const page = read("app/(studio)/intelligence/page.tsx");
  const files = ["IntelligenceView", "GrowthOverview", "SignalSection", "FormatPerformance", "PlatformComparison", "BestPerformingContent", "NextContentRecommendations", "bits"].map((f) => read(`components/intelligence/${f}.tsx`));

  test("the server page is dynamic, titled, and survives a failed first read", () => {
    expect(page).toContain('export const dynamic = "force-dynamic"');
    expect(page).toContain('title: "Content Intelligence"');
    expect(page).toContain("getCurrentUser()");
    expect(page).toContain("overview(user,");
    expect(page).toContain(".catch(() => null)");
    expect(read("app/(studio)/intelligence/loading.tsx")).toContain("RouteSkeleton");
  });
  test("every section is rendered by the view, in the spec's order", () => {
    const order = ["<GrowthOverview", "<WhatIsWorking", "<WhatNeedsAttention", "<FormatPerformance", "<PlatformComparison", "<BestPerformingContent", "<NextContentRecommendations"];
    let at = -1;
    for (const tag of order) {
      const i = view.indexOf(tag);
      expect(i, tag).toBeGreaterThan(at);
      at = i;
    }
    expect(view).toContain("<LaterCard");
  });
  test("the two later sections say so instead of showing fake numbers", () => {
    const bits = read("components/intelligence/bits.tsx");
    expect(bits).toContain("Coming in a later round");
    expect(view).toContain("Topic and category insights");
    expect(view).toContain("Weekly intelligence report");
  });
  test("the window and objective switches are real radio groups, and the objective is not saved here", () => {
    expect(view).toContain('role="radiogroup"');
    expect(view).toContain('aria-label="Time window"');
    expect(view).toContain('aria-checked=');
    expect(view).toContain("Settings, Brand");
    expect(view).toContain("overviewUrl(");
    expect(view).not.toContain("method: \"POST\"");
  });
  test("the recommendation card shows every required field and gates the button on an id", () => {
    const rec = read("components/intelligence/NextContentRecommendations.tsx");
    for (const bit of ["r.title", "r.concept", "r.why", "evidenceLine(r.evidence)", "r.postsAnalyzed", "r.period", "r.confidence", "createHref(r.id)"]) expect(rec).toContain(bit);
    expect(rec).toContain("{href && (");
    expect(rec).toContain("Create from this");
  });
  test("the house rules hold in every file of the page", () => {
    for (const src of [...files, page, read("app/(studio)/intelligence/loading.tsx")]) {
      expect(src).not.toContain("transition-all");
      expect(src).not.toContain("\u2014");
    }
    expect(files.join("\n")).toContain("min-h-11");
    expect(view).toContain("focus-visible:outline");
  });
  test("the client never imports a value from the server-only service", () => {
    const types = read("components/intelligence/types.ts");
    expect(types).toContain('export type { Overview } from "@/lib/intelligence/service"');
    for (const src of files) expect(src).not.toMatch(/^import \{ [^}]*\} from "@\/lib\/intelligence\/service"/m);
  });
});
