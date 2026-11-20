/**
 * R1248: dashboard completeness. Topic insights from overview.topics, the planner's buttons per status (only legal
 * moves, reject confirmed, feedback once), the outcome line on accepted and done cards, the posts-cap sentence, and
 * GET /api/recommendations attaching outcomes owner-scoped.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";
import { MIN_SAMPLE, type MetricStat, type TopicInsight } from "../lib/intelligence/core";
import type { Outcome } from "../lib/intelligence/outcome-core";
import { NOTE_MAX } from "../lib/intelligence/planner-core";
import {
  MEASURING_TEXT, POSTS_CAPPED_TEXT, hasOutcomeLine, outcomeLine, recControls, recStatusWord, topicLiftText, topicStatusWord, topicsEmptyText, withOutcomes,
} from "../components/intelligence/view-core";
import { TopicInsights } from "../components/intelligence/TopicInsights";
import { RecActionsView, type RecActionsViewProps } from "../components/intelligence/RecActions";
import { OutcomeLine } from "../components/intelligence/NextContentRecommendations";
import { GrowthOverview } from "../components/intelligence/GrowthOverview";
import type { Overview } from "../components/intelligence/types";

const jar: Map<string, { value: string; opts: Record<string, unknown> }> = ((globalThis as { __testCookieJar?: Map<string, { value: string; opts: Record<string, unknown> }> }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (k: string) => jar.has(k),
  set: (k: string, v?: string, o?: Record<string, unknown>) => void jar.set(k, { value: v ?? "", opts: o ?? {} }),
  delete: (k: string) => jar.delete(k),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));
const g = globalThis as unknown as { __r1248User?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__r1248User !== undefined ? g.__r1248User : realGetCurrentUser()) }));

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/&#x27;/g, "'");
const CAUSAL = /because|caused|thanks to|led to|drove|due to/i;

const stat = (o: Partial<MetricStat> = {}): MetricStat => ({ metric: "comments", availability: "available", median: 42, n: 4, ...o });
const topic = (o: Partial<TopicInsight> = {}): TopicInsight => ({
  topic: "Recipes",
  n: 5,
  scored: 4,
  metrics: [stat({ metric: "engagementRate", median: 3.2 }), stat()],
  engagementRate: 3.2,
  postShare: 40,
  lift: 36.4,
  metric: "comments",
  confidence: "low",
  sufficient: true,
  rank: 1,
  platform: "instagram",
  format: "carousel",
  ...o,
});
const outcome = (o: Partial<Outcome> = {}): Outcome => ({
  metric: "views",
  value: 300,
  cohortMedian: 200,
  lift: 50,
  n: 3,
  verdict: "early signal up",
  confidence: "low",
  summary: "Early signal up: 300 views, 50% above the 200 median of your 3 other Instagram videos. One post is not proof.",
  ...o,
});

describe("R1248 topic insights", () => {
  test("a sufficient topic row shows posts, the lead metric's median, the lift and a confidence word", () => {
    const out = html(createElement(TopicInsights, { topics: [topic(), topic({ topic: "Travel", scored: 2, n: 2, sufficient: false, lift: 80, rank: null })] }));
    expect(out).toContain("Topic and category insights");
    expect(out).toContain("Recipes");
    expect(out).toContain("5 (4 with numbers to compare)");
    expect(out).toContain("Median comments");
    expect(out).toContain(">42<");
    expect(out).toContain("Up 36% vs your usual posts of the same platform and format");
    expect(out).toContain("Low confidence");
    // The thin topic says what it lacks and makes no claim.
    expect(out).toContain(`Not enough posts yet: 2 of the ${MIN_SAMPLE} needed`);
    expect(out).not.toContain("Up 80%");
  });
  test("a lift is only claimed once the topic is sufficient", () => {
    expect(topicLiftText(topic({ sufficient: false }))).toBeNull();
    expect(topicLiftText(topic({ lift: null }))).toBeNull();
    expect(topicLiftText(topic({ lift: -25 }))).toBe("Down 25% vs your usual posts of the same platform and format");
    expect(topicStatusWord(topic())).toBeNull();
  });
  test("the empty state says how many posts the closest topic still needs", () => {
    const thin = [topic({ topic: "Travel", scored: 1, sufficient: false }), topic({ topic: "Gear", scored: 2, sufficient: false })];
    const out = html(createElement(TopicInsights, { topics: thin }));
    expect(out).toContain(`No topic has ${MIN_SAMPLE} posts with numbers yet. The closest, Gear, has 2 of the ${MIN_SAMPLE} needed: 1 more post on it`);
    expect(out).not.toContain("<li");
    expect(topicsEmptyText([])).toContain(`A topic needs ${MIN_SAMPLE} posts with numbers`);
    expect(html(createElement(TopicInsights, { topics: [] }))).toContain("None of the posts in this period has a topic or category yet.");
  });
  test("a metric the platform does not give is a word, never 0", () => {
    const out = html(createElement(TopicInsights, { topics: [topic({ platform: "youtube", metrics: [stat({ availability: "unavailable", median: null })] })] }));
    expect(out).toContain("Not provided by YouTube");
  });
});

const props = (o: Partial<RecActionsViewProps> = {}): RecActionsViewProps => ({
  id: "rec1",
  status: "open",
  confirming: false,
  feedbackGiven: false,
  pending: false,
  error: null,
  thanks: false,
  note: "",
  onMove: () => {},
  onAskReject: () => {},
  onCancelReject: () => {},
  onNote: () => {},
  onFeedback: () => {},
  ...o,
});
const buttons = (o: Partial<RecActionsViewProps>) => {
  const out = html(createElement(RecActionsView, props(o)));
  return { out, has: (label: string) => out.includes(`>${label}<`) };
};

describe("R1248 planner actions on a card", () => {
  test("only the legal moves of each status", () => {
    expect(recControls("open")).toEqual(["create", "save", "reject", "feedback"]);
    expect(recControls("saved")).toEqual(["create", "reject", "feedback"]);
    expect(recControls("accepted")).toEqual(["done", "reject", "feedback"]);
    expect(recControls("edited")).toEqual(["done", "reject", "feedback"]);
    for (const s of ["done", "rejected", "expired", "nonsense"]) expect(recControls(s)).toEqual(["feedback"]);
    const labels = ["Create from this", "Save for later", "Mark done", "Not for me"];
    const want: Record<string, string[]> = {
      open: ["Create from this", "Save for later", "Not for me"],
      saved: ["Create from this", "Not for me"],
      accepted: ["Mark done", "Not for me"],
      done: [],
      expired: [],
    };
    for (const [status, shown] of Object.entries(want)) {
      const b = buttons({ status });
      for (const l of labels) expect(b.has(l), `${status}: ${l}`).toBe(shown.includes(l));
      expect(b.has("Yes") && b.has("No"), `${status}: feedback`).toBe(true);
    }
    expect(buttons({ status: "open" }).out).toContain('href="/create?rec=rec1"');
    expect(recStatusWord("expired")).toBe("Expired");
    expect(recStatusWord("saved")).toBe("Saved for later");
    expect(recStatusWord("rejected")).toBe("Not for me");
  });
  test("reject needs a confirm step", () => {
    expect(recControls("open", { confirming: true })).toEqual(["create", "save", "reject-confirm", "reject-cancel", "feedback"]);
    const ask = buttons({ status: "open" });
    expect(ask.has("Not for me")).toBe(true);
    expect(ask.has("Yes, not for me")).toBe(false);
    const confirm = buttons({ status: "open", confirming: true });
    expect(confirm.has("Yes, not for me")).toBe(true);
    expect(confirm.has("Keep it")).toBe(true);
    expect(confirm.has("Not for me")).toBe(false);
    const src = read("components/intelligence/RecActions.tsx");
    // The first click only asks; the move is sent from the confirm button.
    expect(src).toContain("onClick={p.onAskReject}");
    expect(src).toContain('onClick={() => p.onMove("reject")}');
  });
  test("feedback is offered once, with a note capped at NOTE_MAX", () => {
    const once = buttons({ status: "accepted" });
    expect(once.out).toContain(`maxLength="${NOTE_MAX}"`);
    expect(once.out).toContain("Was this helpful?");
    expect(recControls("open", { feedbackGiven: true })).not.toContain("feedback");
    const given = buttons({ status: "accepted", feedbackGiven: true, thanks: true });
    expect(given.out).not.toContain("Was this helpful?");
    expect(given.out).toContain("Thanks, your feedback is saved.");
  });
  test("a server refusal is said inline; the client posts {action, payload} and reverts on error", () => {
    expect(buttons({ error: "A recommendation that is done can't be saved." }).out).toContain('role="alert"');
    const src = read("components/intelligence/RecActions.tsx");
    expect(src).toContain('{ method: "POST", json: { action, payload } }');
    expect(src).toContain("/api/recommendations/${encodeURIComponent(id)}");
    expect(src).toContain('onStatus(err instanceof ApiError && err.code === "EXPIRED" ? "expired" : before)');
    expect(src).not.toContain('"edit"');
    expect(read("components/intelligence/NextContentRecommendations.tsx")).toContain("recStatusWord(status)");
  });
});

describe("R1248 outcome line", () => {
  test("an outcome is an early signal with its confidence, never a cause", () => {
    const line = outcomeLine(outcome());
    expect(line.text).toBe("Early signal, up: 300 views, 50% above the 200 median of your 3 other Instagram videos. One post is not proof.");
    expect(line.confidence).toBe("low");
    expect(line.text).not.toMatch(CAUSAL);
    expect(outcomeLine(outcome({ verdict: "in line", summary: "In line: 210 views, close to the 200 median of your 3 other Instagram videos." })).text).toBe("Early signal, in line: 210 views, close to the 200 median of your 3 other Instagram videos.");
    const out = html(createElement(OutcomeLine, { outcome: { ...outcome(), postId: "p1", measuredAt: new Date().toISOString() } }));
    expect(out).toContain("Early signal, up:");
    expect(out).toContain("Low confidence");
  });
  test("no outcome yet, or too early, reads as measuring", () => {
    expect(outcomeLine(null)).toEqual({ text: MEASURING_TEXT, confidence: null });
    expect(MEASURING_TEXT).toBe("Measuring: first reading 48 h after publishing");
    expect(outcomeLine(outcome({ verdict: "too early", summary: "Too early: numbers keep climbing for the first 48 hours, so Outlly waits before comparing." })).text).toBe("Measuring: numbers keep climbing for the first 48 hours, so Outlly waits before comparing.");
    const out = html(createElement(OutcomeLine, { outcome: null }));
    expect(out).toContain(MEASURING_TEXT);
    expect(out).not.toContain("confidence");
  });
  test("only accepted and done cards carry the line", () => {
    for (const s of ["accepted", "done"]) expect(hasOutcomeLine(s)).toBe(true);
    for (const s of ["open", "saved", "edited", "rejected", "expired"]) expect(hasOutcomeLine(s)).toBe(false);
    const rows = withOutcomes([{ id: "a", status: "accepted" }, { id: "b", status: "open" }, { id: "c", status: "done" }], { a: 1, b: 2 });
    expect(rows).toEqual([{ id: "a", status: "accepted", outcome: 1 }, { id: "b", status: "open" }, { id: "c", status: "done", outcome: null }]);
  });
});

const overviewOf = (o: Partial<Overview> = {}): Overview => ({
  period: { from: "2026-10-23", to: "2026-11-20", label: "Last 28 days", days: 28 },
  previous: { from: "2026-09-25", to: "2026-10-23", label: "The 28 days before", days: 28 },
  objective: "engagement",
  posts: 10,
  postsAnalyzed: 20,
  formats: [],
  topics: [],
  working: [],
  attention: [],
  recommendations: [],
  recommendationsReason: null,
  postsCapped: false,
  generatedAt: new Date().toISOString(),
  ...o,
});

describe("R1248 posts cap", () => {
  test("the sentence appears only when the overview hit the cap", () => {
    expect(POSTS_CAPPED_TEXT).toBe("Only the newest 2000 posts are compared in this period.");
    expect(html(createElement(GrowthOverview, { data: overviewOf({ postsCapped: true }), objectiveLabel: "Engagement" }))).toContain(POSTS_CAPPED_TEXT);
    expect(html(createElement(GrowthOverview, { data: overviewOf(), objectiveLabel: "Engagement" }))).not.toContain(POSTS_CAPPED_TEXT);
  });
});

describe("R1248 wiring and house rules", () => {
  test("the view renders topics, passes outcomes down, and the page sends the first read's outcomes", () => {
    const view = read("components/intelligence/IntelligenceView.tsx");
    expect(view).toContain("<TopicInsights topics={data.topics} />");
    expect(view).toContain("outcomes={outcomes}");
    expect(view).toContain("/api/recommendations?");
    expect(view).not.toContain("<LaterCard");
    const page = read("app/(studio)/intelligence/page.tsx");
    expect(page).toContain("outcomesFor(user.id, accepted)");
    expect(page).toContain("initialOutcomes={initialOutcomes}");
  });
  test("new files keep the house rules and import planner-core as a pure module only", () => {
    const srcs = ["TopicInsights", "RecActions", "NextContentRecommendations", "GrowthOverview", "IntelligenceView"].map((f) => read(`components/intelligence/${f}.tsx`));
    for (const s of [...srcs, read("components/intelligence/view-core.ts"), read("app/api/recommendations/route.ts")]) {
      expect(s).not.toContain("transition-all");
      expect(s).not.toContain("\u2014");
    }
    // Client files and view-core never pull a server-only module in as a value.
    for (const s of [...srcs, read("components/intelligence/view-core.ts")]) expect(s).not.toMatch(/^import \{[^}]*\} from "@\/lib\/intelligence\/(planner|service|outcome|reco)"/m);
    const actions = read("components/intelligence/RecActions.tsx");
    expect(actions).toContain("min-h-11");
    expect(actions).toContain("focus-visible:outline");
    expect(read("components/intelligence/view-core.ts")).not.toContain('"use client"');
  });
});

let db: typeof import("../lib/db").db;
let list: typeof import("../app/api/recommendations/route");
let n = 0;
beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  list = await import("../app/api/recommendations/route");
}, 60_000);
afterAll(() => {
  delete g.__r1248User;
});

const mkUser = () => db.user.create({ data: { name: `D ${++n}`, email: `r1248-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
const mkRec = (ownerId: string, status: string) => {
  const today = new Date().toISOString().slice(0, 10);
  return db.recommendation.create({
    data: {
      ownerId, scopeKey: "", dedupeKey: `d${++n}`, title: "Make more carousels", concept: "Carousels.", why: "Carousels beat videos.",
      evidence: JSON.stringify({ metric: "views" }), postsAnalyzed: 6, periodFrom: today, periodTo: today, confidence: "low",
      format: "carousel", platform: "instagram", nextAction: JSON.stringify({ kind: "create", label: "Draft it", prefill: { platform: "instagram", format: "carousel", topic: null, basedOn: [] } }), status,
    },
  });
};
const addOutcome = (recommendationId: string, summary: string) =>
  db.recommendationEvent.create({ data: { recommendationId, type: "outcome", data: JSON.stringify({ ...outcome({ summary }), postId: "p1", measuredAt: new Date().toISOString() }) } });
const req = (path: string) => new NextRequest(`http://localhost${path}`, { method: "GET", headers: { origin: "http://localhost", host: "localhost" } });

describe("R1248 GET /api/recommendations outcomes", () => {
  test("outcome is attached to accepted and done rows only, and never from another owner", async () => {
    const a = await mkUser();
    const b = await mkUser();
    const open = await mkRec(a.id, "open");
    const accepted = await mkRec(a.id, "accepted");
    const done = await mkRec(a.id, "done");
    const saved = await mkRec(a.id, "saved");
    const theirs = await mkRec(b.id, "accepted");
    await addOutcome(accepted.id, "Early signal up: mine.");
    await addOutcome(open.id, "Early signal up: open row, never shown.");
    await addOutcome(theirs.id, "Early signal up: theirs.");

    g.__r1248User = { ...a, role: "owner", joinedAt: a.createdAt, actor: null, scope: null };
    const res = await list.GET(req("/api/recommendations?limit=50"), { params: {} });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recommendations: { id: string; status: string; outcome?: { summary: string } | null }[] };
    const byId = new Map(body.recommendations.map((r) => [r.id, r]));
    expect(byId.has(theirs.id)).toBe(false);
    expect(byId.get(accepted.id)!.outcome!.summary).toBe("Early signal up: mine.");
    expect(byId.get(done.id)!.outcome).toBeNull();
    expect("outcome" in byId.get(open.id)!).toBe(false);
    expect("outcome" in byId.get(saved.id)!).toBe(false);

    g.__r1248User = { ...b, role: "owner", joinedAt: b.createdAt, actor: null, scope: null };
    const other = (await (await list.GET(req("/api/recommendations?status=accepted&limit=50"), { params: {} })).json()) as { recommendations: { id: string; outcome?: { summary: string } | null }[] };
    expect(other.recommendations.map((r) => r.id)).toEqual([theirs.id]);
    expect(other.recommendations[0].outcome!.summary).toBe("Early signal up: theirs.");
  });
});
