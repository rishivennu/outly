/**
 * R1325 (Phase 7): app integration. The pure pulse summary (top format, honest lines, email items), the stored pulse
 * (states + one open recommendation + clipper counts, never a write), the two Pip tools (`predictions`,
 * `clipper_status`: routing, summaries, empty states), the Home card and the Monday email's "Your baselines" section,
 * and the Android contract doc.
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { baselineItems, baselineLine, clipperLine, pickTop, pulseLines, type IntelligencePulse } from "../lib/intelligence/pulse-core";
import { clipperSummary, predictionsSummary } from "../lib/pip/tools-intelligence";
import { ANALYTIC_TOOLS, PIP_TOOLS } from "../lib/pip/types";
import { withIntelligence } from "./helpers/intelligence-plan";

mock.module("next/headers", () => ({
  cookies: () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
  headers: () => new Headers(),
}));

let db: typeof import("../lib/db").db;
let pulse: typeof import("../lib/intelligence/pulse");
let tools: typeof import("../lib/pip/tools");
let plan: typeof import("../lib/pip/plan");
let weekly: typeof import("../lib/reports/weekly");
let feat: typeof import("../lib/intelligence/features");
let pred: typeof import("../lib/intelligence/model/predict");

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  pulse = await import("../lib/intelligence/pulse");
  tools = await import("../lib/pip/tools");
  plan = await import("../lib/pip/plan");
  weekly = await import("../lib/reports/weekly");
  feat = await import("../lib/intelligence/features");
  pred = await import("../lib/intelligence/model/predict");
}, 60_000);

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const DAY = 864e5;

const sample: IntelligencePulse = {
  platforms: [
    { platform: "instagram", level: "personal", measured: 14, accuracyWords: "Typically within 20% so far.", top: { format: "video", predicted: 1200, low: 800, high: 1900, n: 12, shared: null } },
    { platform: "youtube", level: "general", measured: 0, accuracyWords: null, top: { format: "video", predicted: 500, low: 300, high: 900, n: 0, shared: { n: 40, owners: 6 } } },
    { platform: "threads", level: "none", measured: 0, accuracyWords: null, top: null },
  ],
  recommendation: { id: "personal:format:video:instagram", title: "Lead with video on Instagram", why: "Your 12 videos beat your 4 photos by 60%.", platform: "instagram", confidence: "medium" },
  clipper: { queued: 0, running: 1, review: 2, readyToPost: 3, published: 4, failed: 0 },
  computedAt: "2026-11-24T12:00:00.000Z",
};

describe("R1325 pulse-core", () => {
  test("pickTop prefers the deepest own sample, then the cohort-backed one", () => {
    expect(pickTop([])).toBeNull();
    expect(pickTop([{ format: "photo", predicted: 1, low: 1, high: 1, n: 2, shared: null }, { format: "video", predicted: 1, low: 1, high: 1, n: 9, shared: null }])?.format).toBe("video");
    expect(pickTop([{ format: "photo", predicted: 1, low: 1, high: 1, n: 0, shared: null }, { format: "video", predicted: 1, low: 1, high: 1, n: 0, shared: { n: 30, owners: 5 } }])?.format).toBe("video");
  });

  test("lines name the sample and never show a number for nothing measured", () => {
    const [ig, yt, th] = sample.platforms;
    expect(baselineLine(ig)).toBe("Instagram video: ~1,200 views (usually 800 to 1,900), from 12 measured posts of yours. Typically within 20% so far.");
    expect(baselineLine(yt)).toBe("YouTube video: ~500 views (usually 300 to 900), from 40 cohort posts by 6 creators scaled to your size; none of your own measured yet.");
    expect(baselineLine(th)).toBe("Threads: no measured post yet, so no number.");
    expect(clipperLine(null)).toBeNull();
    expect(clipperLine(sample.clipper)).toBe("1 job running, 2 jobs waiting for your review, 3 clips rendered and ready to post; 4 clips published so far.");
    expect(clipperLine({ queued: 0, running: 0, review: 0, readyToPost: 0, published: 0, failed: 0 })).toBe("Nothing in the clipper queue.");
    expect(clipperLine({ queued: 2, running: 0, review: 0, readyToPost: 0, published: 0, failed: 0 })).toBe("2 jobs waiting to start.");
    expect(clipperLine({ queued: 0, running: 0, review: 0, readyToPost: 0, published: 2, failed: 1 })).toBe("1 job failed; 2 clips published so far.");
    const lines = pulseLines(sample);
    expect(lines).toHaveLength(5);
    expect(lines[3]).toContain("Made for you: Lead with video on Instagram (Instagram, medium).");
    expect(lines[4]).toStartWith("Shorts clipper: 1 job running");
    expect(lines.join(" ")).not.toContain("NaN");
  });

  test("email items: at most three platforms, each with its sample; none without a baseline", () => {
    const items = baselineItems(sample);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ title: "Instagram video: ~1,200 views", detail: "usually 800 to 1,900, from 12 measured posts of yours. Typically within 20% so far." });
    expect(items[1].detail).toContain("from 40 cohort posts by 6 creators scaled to your size; none of your own measured yet.");
    expect(baselineItems(null)).toEqual([]);
    expect(baselineItems({ ...sample, platforms: [sample.platforms[2]] })).toEqual([]);
  });
});

describe("R1325 Pip summaries (pure)", () => {
  test("predictions: cards, one row per platform, the facts are the pulse lines; a named platform narrows; honest empties", () => {
    const s = predictionsSummary(sample, null);
    expect(s.cards.map((c) => c.label)).toEqual(["Measured posts", "Platforms", "On your own results"]);
    expect(s.cards[0].value).toBe("14");
    expect(s.cards[2].value).toBe("1 of 3");
    expect(s.rows.map((r) => r.cells.platform)).toEqual(["Instagram", "YouTube", "Threads"]);
    expect(s.rows[0].cells).toMatchObject({ typical: "~1,200", range: "800 to 1,900", sample: "from 12 measured posts of yours" });
    expect(s.rows[1].cells.sample).toBe("from 40 cohort posts by 6 creators scaled to your size; none of your own measured yet");
    expect(s.rows[2].cells).toMatchObject({ format: "—", typical: null, range: null });
    expect(s.facts).toEqual(sample.platforms.map(baselineLine));
    expect(predictionsSummary(sample, "youtube").rows).toHaveLength(1);
    expect(predictionsSummary(sample, "linkedin").empty).toContain("Nothing measured on LinkedIn yet");
    expect(predictionsSummary(null, null).empty).toContain("Nothing measured yet");
    expect(predictionsSummary(null, null).facts).toHaveLength(1);
  });

  test("clipper_status: counts as cards and rows, the failed row only when there is one", () => {
    const s = clipperSummary(sample.clipper);
    expect(s.cards.map((c) => [c.label, c.value])).toEqual([["Running", "1"], ["Waiting for review", "2"], ["Ready to post", "3"], ["Published", "4"]]);
    expect(s.rows.map((r) => r.id)).toEqual(["running", "review", "ready", "published"]);
    expect(clipperSummary({ ...sample.clipper!, failed: 2 }).rows.map((r) => r.id)).toContain("failed");
    expect(clipperSummary({ ...sample.clipper!, queued: 1 }).rows.map((r) => r.id)).toContain("queued");
    expect(clipperSummary(null).empty).toContain("No clipper job yet");
    expect(clipperSummary(null).rows).toEqual([]);
  });

  test("routing and registry", () => {
    expect(PIP_TOOLS.length).toBe(28);
    expect(PIP_TOOLS).toContain("predictions");
    expect(PIP_TOOLS).toContain("clipper_status");
    expect(ANALYTIC_TOOLS).toContain("predictions");
    expect(ANALYTIC_TOOLS).not.toContain("clipper_status");
    expect(plan.keywordPlan("what are my baselines?")?.tool).toBe("predictions");
    expect(plan.keywordPlan("how many views will my next reel get?")?.tool).toBe("predictions");
    expect(plan.keywordPlan("what does my typical video do on youtube")?.tool).toBe("predictions");
    expect(plan.keywordPlan("show my predictions")?.tool).toBe("predictions");
    expect(plan.keywordPlan("how is the clipper doing?")?.tool).toBe("clipper_status");
    expect(plan.keywordPlan("any clips ready to post?")?.tool).toBe("clipper_status");
    expect(plan.keywordPlan("shorts queue")?.tool).toBe("clipper_status");
    // R1328 review: a trouble report goes to help, and "clips are waiting" counts with the verb between.
    expect(plan.keywordPlan("the clipper is broken")?.tool).not.toBe("clipper_status");
    expect(plan.keywordPlan("my clipper job is stuck")?.tool).not.toBe("clipper_status");
    expect(plan.keywordPlan("how many clips are waiting for review")?.tool).toBe("clipper_status");
    expect(plan.keywordPlan("show my shorts jobs")?.tool).toBe("clipper_status");
    expect(plan.keywordPlan("expected views for a reel")?.tool).toBe("predictions");
    // The analytics projection keeps its own tool; Content Intelligence keeps its words.
    expect(plan.keywordPlan("forecast my views for next month")?.tool).toBe("forecast");
    expect(plan.keywordPlan("what is working in my content?")?.tool).toBe("intelligence_overview");
    expect(plan.keywordPlan("show my invoices")?.tool).toBe("invoices");
    // R1326 review: how-to questions about the product nouns stay with the help bot; metric questions keep their tools.
    for (const q of ["how do I use the clipper", "how does the clipper work?", "can the clipper do 16:9?", "what is a baseline?", "explain baselines", "download my clips"]) expect(plan.keywordPlan(q)).toBeNull();
    expect(plan.keywordPlan("how many views did my clips get this week")?.tool).not.toBe("clipper_status");
    expect(plan.keywordPlan("what's my typical reel reach")?.tool).not.toBe("predictions");
    expect(plan.keywordPlan("baseline engagement rate")?.tool).not.toBe("predictions");
    expect(plan.readPlan({ tool: "clipper_status" })?.tool).toBe("clipper_status");
    expect(plan.PLAN_SYSTEM).toContain("predictions = their own baselines");
    expect(plan.PLAN_SYSTEM).toContain("clipper_status = the Shorts clipper queue");
  });
});

/* ------------------------------------------------------------------ stored */

let n = 0;
const mk = async () => withIntelligence(await db.user.create({ data: { name: `P ${++n}`, email: `r1325-${n}-${Date.now()}-${Math.random()}@test.dev`, passwordHash: "x" } }));

async function seed(ownerId: string, views: number[], platform = "instagram") {
  const account = await db.socialAccount.create({ data: { userId: ownerId, platform, platformUserId: `${platform}-r1325-${Date.now()}-${Math.random()}`, username: "@p", accessToken: "x", status: "connected" } });
  const media = await db.media.create({ data: { userId: ownerId, originalFilename: "v.mp4", storageKey: `r1325/${Date.now()}-${Math.random()}.mp4`, mimeType: "video/mp4", size: 1, status: "ready", duration: 40, width: 1080, height: 1920 } });
  for (const [i, v] of views.entries()) {
    const at = new Date(Date.now() - (10 + i * 5) * DAY);
    const p = await db.post.create({ data: { userId: ownerId, mediaId: media.id, status: "published", publishedAt: at } });
    const t = await db.postTarget.create({ data: { postId: p.id, platform, socialAccountId: account.id, platformStatus: "published", publishedAt: at, caption: "A caption" } });
    await db.targetMetric.create({ data: { targetId: t.id, capturedAt: at, views: v, likes: 1 } });
  }
  return { account, media };
}

const counts = async (ownerId: string) => ({
  recs: await db.recommendation.count({ where: { ownerId } }),
  events: await db.learningEvent.count({ where: { ownerId } }),
  states: await db.creatorModelState.count({ where: { ownerId } }),
  clips: await db.generatedClip.count({ where: { ownerId } }),
});

describe("R1325 stored pulse + tools (db)", () => {
  test("nothing measured and no clipper job: null pulse, honest Pip empties, no card", async () => {
    const u = await mk();
    expect(await pulse.intelligencePulse(u.id)).toBeNull();
    const ctx = { ownerId: u.id, actorId: null, scope: null, tz: "UTC", now: new Date(), message: "my baselines" };
    const r = await tools.runTool("predictions", ctx, {});
    expect(r.rows).toEqual([]);
    expect(r.empty).toContain("Nothing measured yet");
    expect(r.estimate).toBe(true);
    const c = await tools.runTool("clipper_status", ctx, {});
    expect(c.rows).toEqual([]);
    expect(c.empty).toContain("No clipper job yet");
    expect(c.downloads).toEqual([{ label: "Open the Clipper", href: "/clipper" }]);
  });

  test("with measured posts: the pulse carries the platform baseline with its sample and the clipper queue; reads write nothing", async () => {
    const u = await mk();
    const { media } = await seed(u.id, [300, 300, 300, 300, 400]);
    await feat.refreshFeatures(u.id);
    await pred.syncPredictions(u.id);
    const job = await db.clipJob.create({ data: { ownerId: u.id, mediaId: media.id, status: "ready", stage: "review", progress: 1, executor: "browser", settings: "{}" } });
    await db.clipJob.create({ data: { ownerId: u.id, mediaId: media.id, status: "running", stage: "transcribe", progress: 0.2, executor: "browser", settings: "{}" } });
    await db.generatedClip.create({ data: { ownerId: u.id, jobId: job.id, start: 0, end: 20, title: "A", reframe: "{}", subtitle: "{}", status: "approved", renderStatus: "rendered", mediaId: media.id } });
    await db.generatedClip.create({ data: { ownerId: u.id, jobId: job.id, start: 30, end: 50, title: "B", reframe: "{}", subtitle: "{}", status: "published", renderStatus: "rendered", mediaId: media.id } });
    const before = await counts(u.id);
    const p = await pulse.intelligencePulse(u.id);
    expect(p).not.toBeNull();
    expect(p!.platforms).toHaveLength(1);
    expect(p!.platforms[0]).toMatchObject({ platform: "instagram", measured: 5 });
    expect(p!.platforms[0].top).toMatchObject({ format: "video", n: 5 });
    // Below PERSONAL_MIN the shared prior joins whenever a shared document exists (the 1324 suite leaves one behind): null or a sample, never a bare number.
    const sh = p!.platforms[0].top!.shared;
    expect(sh === null || (typeof sh.n === "number" && typeof sh.owners === "number")).toBe(true);
    expect(p!.platforms[0].top!.predicted).toBeGreaterThan(0);
    expect(p!.clipper).toEqual({ queued: 0, running: 1, review: 1, readyToPost: 1, published: 1, failed: 0 });
    expect(await counts(u.id)).toEqual(before);

    const ctx = { ownerId: u.id, actorId: null, scope: null, tz: "UTC", now: new Date(), message: "what are my baselines" };
    const r = await tools.runTool("predictions", ctx, {});
    expect(r.tool).toBe("predictions");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].cells.sample).toStartWith("from 5 measured posts of yours");
    expect(r.rows[0].cells).toMatchObject({ platform: "Instagram", format: "video" });
    // R1326 review: a platform word the model made up never produces a false "nothing on X"; a scoped teammate with no accounts sees nothing of the workspace.
    expect((await tools.runTool("predictions", ctx, { platform: "Instagram" })).rows).toHaveLength(1);
    expect((await tools.runTool("predictions", { ...ctx, scope: [] }, {})).rows).toEqual([]);
    expect((await tools.runTool("predictions", { ...ctx, scope: [] }, {})).empty).toContain("Nothing measured yet");
    expect(r.facts[0]).toContain("from 5 measured posts of yours");
    expect(r.downloads[0].href).toBe("/intelligence#intel-baselines");
    const c = await tools.runTool("clipper_status", ctx, {});
    expect(c.cards?.map((x) => x.value)).toEqual(["1", "1", "1", "1"]);
    expect(c.facts[0]).toBe("1 job running, 1 job waiting for your review, 1 clip rendered and ready to post; 1 clip published so far.");
    expect(await counts(u.id)).toEqual(before);

    // The Monday email: the block gains "Your baselines" with the same sample words; a failing pulse costs nothing.
    const wi = () => ({ enough: false, headline: "H", versus: null, movers: [], attention: [], topRecommendation: null, recommendationNote: null, posts: 1, postsAnalyzed: 1, period: "Last 28 days", objective: "awareness" as const, objectiveLabel: "Awareness", caveats: [], emptyText: "Need more posts." });
    const block = await weekly.intelligenceFor(u.id, async () => wi());
    expect(block?.sections.map((s) => s.label)).toEqual(["Your baselines"]);
    expect(block?.sections[0].items[0].title).toStartWith("Instagram video: ~");
    expect(block?.sections[0].items[0].detail).toContain("from 5 measured posts of yours");
    expect(block?.text).toContain("Your baselines:");
    expect(block?.text).toContain("/intelligence#intel-baselines");
    // R1328 review: the HTML item links are absolute too (the email template writes hrefs verbatim).
    expect(block?.sections[0].items[0].href).toMatch(/^https?:\/\/.+\/intelligence#intel-baselines$/);
    // A scoped pulse carries no clipper counts (the queue has no per-account view); an empty scope is the honest null.
    expect(await pulse.intelligencePulse(u.id, { scopeKey: "", targetIds: [] })).toBeNull();
    const plain = await weekly.intelligenceFor(u.id, async () => wi(), async () => { throw new Error("pulse down"); });
    expect(plain?.sections).toEqual([]);
    expect(await weekly.intelligenceFor(u.id, async () => wi(), async () => null)).toMatchObject({ sections: [] });
  });
});

describe("R1325 wiring", () => {
  test("Home card, Pip registry, Android doc, plan", () => {
    const home = read("app/(studio)/home/page.tsx");
    expect(home).toContain('soft(intelligencePulse(user.id), CARD_MS, null, "home intelligence")');
    expect(home).toContain("{intel && <IntelligencePulseCard p={intel} />}");
    const card = read("components/home/IntelligencePulse.tsx");
    expect(card).toContain('href="/intelligence#intel-baselines"');
    expect(card).toContain('href="/clipper"');
    expect(card).toContain("No measured post yet, so no number.");
    expect(read("lib/pip/tools.ts")).toContain("clipper_status: clipperStatus");
    expect(read("lib/intelligence/pulse-core.ts")).not.toContain("prisma");
    expect(read("lib/intelligence/pulse.ts")).toContain('import "server-only"');
    // The Android repo sits beside this one in the working tree only; a clean clone of the web repo skips these two lines.
    if (existsSync(new URL("../../../outlly-compose/docs/api-intelligence-clipper.md", import.meta.url))) {
      const doc = read("../../outlly-compose/docs/api-intelligence-clipper.md");
      expect(doc).toContain("GET predictions");
      expect(doc).toContain("`/clipper` is NOT registered in the manifest on purpose");
      expect(doc).toContain("GET pulse");
      expect(read("../../outlly-compose/app/src/main/AndroidManifest.xml")).not.toContain('android:path="/clipper"');
    }
    expect(read("docs/intelligence-clipper-plan.md")).toContain("R1325");
  });
});
