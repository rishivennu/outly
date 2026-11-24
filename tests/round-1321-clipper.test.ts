/**
 * R1321: AI Shorts Clipper, phase 5a (schema, service, API). Pure cores (settings clamps, the job state machine,
 * source checks, reframe maths, deterministic candidate ranking, drafted copy), then the service over the database:
 * idempotent job creation and the active-jobs cap, the stage flow start -> transcribed -> detect (rule detector when
 * no model answers) -> approve -> edit (render goes stale) -> render report -> download, tenant isolation, and the
 * wiring (schema models, routes, account deletion, docs).
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { ACTIVE_JOBS_MAX, CLIP_MAX_SEC, CLIP_MIN_SEC, DEFAULT_SETTINGS, MAX_SOURCE_SEC, MIN_SOURCE_SEC, isStalled, nextState, overallProgress, settingsOf, sourceProblem, stageWords, type JobEvent } from "../lib/clipper/settings-core";
import { DEFAULT_REFRAME, drawFor, keptShare, reframeOf } from "../lib/clipper/reframe-core";
import { NO_HINTS, hookScore, personalScore, rankCandidates, scoreCandidate, sweetSpot, widen } from "../lib/clipper/candidates-core";
import { draftCopy, hashtagsOf } from "../lib/clipper/copy-core";
import type { Cue } from "../lib/captions/cues";
import type { Word } from "../lib/captions/subtitle-engine";

mock.module("next/headers", () => ({
  cookies: () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
  headers: () => new Headers(),
}));

let db: typeof import("../lib/db").db;
let jobs: typeof import("../lib/clipper/jobs");

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  jobs = await import("../lib/clipper/jobs");
}, 60_000);

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const has = (p: string) => existsSync(new URL(`../${p}`, import.meta.url));

/* ------------------------------------------------------------------ fixtures */

/** A 120 s talk: one word every 0.4 s, a line every 4 s, with a hooky opening at 40 s. */
function talk(): { words: Word[]; cues: Cue[] } {
  const lines = [
    "today we are going to talk about planning your week",
    "most people start on monday morning without a plan",
    "and then they wonder where the time went by friday",
    "so here is what i do instead every sunday night",
    "i write down the three things that matter most",
    "not ten not twenty just three and that is the rule",
    "because three is what you can actually finish",
    "the second step is to block the time for them first",
    "before email before meetings before anything else",
    "when i started doing this my output doubled in a month",
    "why nobody tells you this is the biggest mistake i see",
    "everyone plans tasks but nobody plans energy",
    "you have maybe four good hours a day use them on the three",
    "the rest of the day is for the small stuff",
    "and that is it that is the whole system",
    "so remember three things block the time protect the hours",
    "the lesson is simple plan less and finish more",
    "if you try it this week tell me how it went",
    "i read every message and i answer most of them",
    "see you in the next one and plan your week",
    "one more thing before you go about the tools i use",
    "a paper notebook nothing fancy works better than any app",
    "because you cannot get a notification from paper",
    "that is why i keep coming back to it after years",
    "ok that is really it this time thanks for watching",
    "and if this helped share it with one friend who needs it",
    "they will thank you on friday when the week is done",
    "take care and plan the three things tonight",
    "bye for now",
    "see you soon",
  ];
  const words: Word[] = [];
  const cues: Cue[] = [];
  lines.forEach((line, i) => {
    const ws = line.split(" ");
    const start = i * 4;
    const step = 3.6 / ws.length;
    ws.forEach((w, k) => words.push({ w, s: Math.round((start + k * step) * 100) / 100, e: Math.round((start + (k + 1) * step) * 100) / 100 }));
    cues.push({ start, end: start + 3.8, text: line });
  });
  return { words, cues };
}

let seq = 0;
async function who(mediaOver: Record<string, unknown> = {}) {
  seq++;
  const tag = `${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 7)}`;
  const user = await db.user.create({ data: { email: `r1321-${tag}@test.dev`, name: "Clipper Tester", passwordHash: "x" } });
  const media = await db.media.create({ data: { userId: user.id, originalFilename: "talk.mp4", storageKey: `r1321/${tag}.mp4`, mimeType: "video/mp4", size: 50_000_000, duration: 120, width: 1920, height: 1080, status: "ready", ...mediaOver } });
  return { user, media, actor: { id: user.id, role: "user" } };
}

/* ------------------------------------------------------------------ pure */

describe("R1321 settings-core", () => {
  test("settingsOf clamps and defaults; unknown platforms and keys are dropped", () => {
    expect(settingsOf(undefined)).toEqual(DEFAULT_SETTINGS);
    const s = settingsOf({ target: 99, minSec: 1, maxSec: 9999, platforms: ["youtube", "myspace", "youtube"], subtitle: { style: "neon", pos: "top", burn: "yes" }, language: "  en-IN-extra-long-tag  ", bogus: 1 });
    expect(s.target).toBe(10);
    expect(s.minSec).toBe(CLIP_MIN_SEC);
    expect(s.maxSec).toBe(CLIP_MAX_SEC);
    expect(s.platforms).toEqual(["youtube"]);
    expect(s.subtitle).toEqual({ style: "pop", pos: "top", burn: true });
    expect(s.language).toBe("en-IN-extra-");
    expect("bogus" in s).toBe(false);
    // maxSec can never sit under minSec.
    expect(settingsOf({ minSec: 60, maxSec: 20 }).maxSec).toBe(62);
  });

  test("sourceProblem names the one thing wrong, in the upload step's words", () => {
    expect(sourceProblem({ mimeType: "video/mp4", status: "ready", size: 1000, duration: 600 })).toBeNull();
    expect(sourceProblem({ mimeType: "image/jpeg" })).toContain("needs a video");
    expect(sourceProblem({ mimeType: "video/mp4", status: "uploading" })).toContain("still uploading");
    expect(sourceProblem({ mimeType: "video/mp4", status: "ready", size: 3 * 1024 ** 3 })).toContain("over 2 GB");
    expect(sourceProblem({ mimeType: "video/mp4", status: "ready", duration: MAX_SOURCE_SEC + 1 })).toContain("over 2 hours");
    expect(sourceProblem({ mimeType: "video/mp4", status: "ready", duration: MIN_SOURCE_SEC - 1 })).toContain("already a short");
    // Unknown duration is not a problem (the browser measures it).
    expect(sourceProblem({ mimeType: "video/mp4", status: "ready", duration: null })).toBeNull();
  });

  test("nextState: the allowed transitions and nothing else", () => {
    const ok: [string, string, JobEvent, string, string][] = [
      ["queued", "transcribe", "start", "running", "transcribe"],
      ["running", "transcribe", "transcribed", "running", "detect"],
      ["running", "detect", "detected", "ready", "review"],
      ["ready", "review", "reviewed", "ready", "done"],
      ["running", "detect", "fail", "failed", "detect"],
      ["failed", "detect", "retry", "queued", "detect"],
      ["failed", "detect", "start", "running", "detect"],
      ["queued", "transcribe", "cancel", "cancelled", "transcribe"],
      ["running", "transcribe", "start", "running", "transcribe"],
    ];
    for (const [s, g, ev, s2, g2] of ok) expect(nextState({ status: s, stage: g }, ev)).toEqual({ status: s2, stage: g2 });
    const no: [string, string, JobEvent][] = [
      ["queued", "transcribe", "transcribed"],
      ["running", "detect", "transcribed"],
      ["running", "transcribe", "detected"],
      ["ready", "review", "fail"],
      ["ready", "review", "start"],
      ["cancelled", "transcribe", "start"],
      ["cancelled", "transcribe", "retry"],
      ["ready", "done", "reviewed"],
    ];
    for (const [s, g, ev] of no) expect(nextState({ status: s, stage: g }, ev)).toBeNull();
  });

  test("progress, stall and words", () => {
    expect(overallProgress("transcribe", 0.5)).toBe(0.35);
    expect(overallProgress("detect", 0)).toBe(0.7);
    expect(overallProgress("review", 1)).toBe(1);
    expect(overallProgress("transcribe", NaN)).toBe(0);
    const now = Date.now();
    expect(isStalled({ status: "running", heartbeatAt: new Date(now - 6 * 60_000), updatedAt: new Date(now) }, now)).toBe(true);
    expect(isStalled({ status: "running", heartbeatAt: null, updatedAt: new Date(now - 60_000) }, now)).toBe(false);
    expect(isStalled({ status: "ready", heartbeatAt: new Date(now - 60 * 60_000), updatedAt: new Date(now) }, now)).toBe(false);
    expect(stageWords({ status: "failed", stage: "detect", error: "no audio" })).toBe("Stopped: no audio");
    expect(stageWords({ status: "ready", stage: "review" })).toContain("ready to review");
  });
});

describe("R1321 reframe-core", () => {
  test("crop: a 16:9 source keeps a 9:16 window slid by x, in whole pixels inside the source", () => {
    const d = drawFor(1920, 1080, { mode: "crop", x: 0.5, y: 0.5 });
    expect(d.sw).toBe(608); // 1080 * 9/16 = 607.5 -> 608
    expect(d.sh).toBe(1080);
    expect(d.sx).toBe(656);
    expect(d.dw).toBe(1080);
    expect(d.dh).toBe(1920);
    expect(d.backdrop).toBe(false);
    expect(drawFor(1920, 1080, { mode: "crop", x: 0, y: 0.5 }).sx).toBe(0);
    expect(drawFor(1920, 1080, { mode: "crop", x: 1, y: 0.5 }).sx).toBe(1920 - 608);
    expect(keptShare(1920, 1080, { mode: "crop", x: 0.5, y: 0.5 })).toBe(0.32); // 608 / 1920, two decimals
  });
  test("pillarbox fits the whole picture with a blurred backdrop; a 9:16 source needs neither", () => {
    const p = drawFor(1920, 1080, { mode: "pillarbox", x: 0.5, y: 0.5 });
    expect([p.sx, p.sy, p.sw, p.sh]).toEqual([0, 0, 1920, 1080]);
    expect(p.dw).toBe(1080);
    expect(p.dh).toBe(608);
    expect(p.dy).toBe(656);
    expect(p.backdrop).toBe(true);
    const v = drawFor(1080, 1920, { mode: "pillarbox", x: 0.5, y: 0.5 });
    expect([v.dx, v.dy, v.dw, v.dh, v.backdrop]).toEqual([0, 0, 1080, 1920, false]);
    expect(keptShare(1920, 1080, { mode: "pillarbox", x: 0.5, y: 0.5 })).toBe(1);
  });
  test("reframeOf clamps to the unit range and falls back to centre crop", () => {
    expect(reframeOf(null)).toEqual(DEFAULT_REFRAME);
    expect(reframeOf({ mode: "pillarbox", x: 7, y: -1 })).toEqual({ mode: "pillarbox", x: 1, y: 0 });
    expect(reframeOf({ mode: "zoom", x: "0.25" })).toEqual({ mode: "crop", x: 0.25, y: 0.5 });
  });
});

describe("R1321 candidates-core", () => {
  const { words, cues } = talk();
  const settings = settingsOf({ platforms: ["instagram", "youtube"], minSec: 10, maxSec: 45 });

  test("every score is deterministic and the reason reads back the numbers", () => {
    expect(hookScore("why nobody tells you this is the biggest mistake")).toBeGreaterThan(hookScore("and the rest of the day is for the small stuff"));
    expect(sweetSpot(settings)).toBe(38); // (30 + 45) / 2 = 37.5 -> 38
    const a = scoreCandidate({ start: 40, end: 72 }, "ai", { cues, words, settings, hints: NO_HINTS });
    const b = scoreCandidate({ start: 40, end: 72 }, "ai", { cues, words, settings, hints: NO_HINTS });
    expect(a).toEqual(b);
    expect(a.scores.total).toBeCloseTo(0.3 * a.scores.hook + 0.25 * a.scores.selfContained + 0.2 * a.scores.length + 0.1 * a.scores.density + 0.15 * a.scores.personal, 3);
    expect(a.reason).toMatch(/opens strong|a fair opening|a slow opening/);
    expect(a.reason).toMatch(/\d+ s/);
    expect(a.kind).toBe("story"); // "when i started doing this" is a story line
    // Without personal history the personal part is neutral; with a hook lift it moves a hooky clip up.
    expect(a.scores.personal).toBe(0.5);
    expect(personalScore({ hookLiftPct: 80, shortVideoLiftPct: null }, 0.9, 30)).toBeGreaterThan(0.5);
    expect(personalScore({ hookLiftPct: 80, shortVideoLiftPct: null }, 0.1, 30)).toBeLessThan(0.5);
  });

  test("rankCandidates fits, drops overlaps, orders by score then time, numbers ranks", () => {
    const ranked = rankCandidates(
      [
        { start: 0, end: 70, title: "Whole opening" }, // too long: trimmed at a line end within 45 s
        { start: 40, end: 72, title: "Mistake", why: "Names the mistake" },
        { start: 42, end: 70, title: "Overlaps mistake" }, // > 30% overlap with the one above: the lower goes
        { start: 100, end: 104 }, // too short: dropped
        { start: 60, end: 100, title: "Lesson" },
      ],
      { cues, words, settings, hints: NO_HINTS },
    );
    expect(ranked.map((c) => c.rank)).toEqual(ranked.map((_, i) => i + 1));
    expect(ranked.find((c) => c.start === 100)).toBeUndefined();
    const opening = ranked.find((c) => c.start === 0);
    expect(opening).toBeDefined();
    expect(opening!.end - opening!.start).toBeLessThanOrEqual(45);
    expect(cues.some((c) => c.end === opening!.end)).toBe(true);
    const mistakes = ranked.filter((c) => c.start >= 40 && c.start <= 42);
    expect(mistakes).toHaveLength(1);
    expect(mistakes[0].reason.startsWith("Names the mistake. ")).toBe(true);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].score >= ranked[i].score).toBe(true);
    // widen: a one-second phrase grows to whole lines, phrase first, to at least the shortest clip.
    const w = widen({ start: 84.4, end: 85.6 }, cues, 8, 45, 120);
    expect(w.start).toBe(84);
    expect(w.end).toBeGreaterThanOrEqual(92);
    expect(w.end - w.start).toBeLessThanOrEqual(45);
    expect(cues.some((c) => c.end === w.end)).toBe(true);
    const tail = widen({ start: 118, end: 119 }, cues, 8, 45, 120);
    expect(tail.end).toBeLessThanOrEqual(120);
    expect(tail.end - tail.start).toBeGreaterThanOrEqual(8);
    // The whole thing is pure: the same input gives the same list.
    expect(rankCandidates([{ start: 40, end: 72 }, { start: 60, end: 100 }], { cues, words, settings, hints: NO_HINTS })).toEqual(rankCandidates([{ start: 40, end: 72 }, { start: 60, end: 100 }], { cues, words, settings, hints: NO_HINTS }));
  });
});

describe("R1321 rule detector", () => {
  test("ruleWindows covers the whole video and samples down to the cap", () => {
    const cues: Cue[] = Array.from({ length: 1800 }, (_, i) => ({ start: i * 4, end: i * 4 + 3.8, text: `line ${i} of a two hour talk about planning` }));
    const settings = settingsOf({ minSec: 10, maxSec: 45 });
    const w = jobs.ruleWindows(cues, settings);
    expect(w.length).toBe(jobs.RULE_WINDOWS_MAX);
    expect(w[0].start).toBe(0);
    expect(w[w.length - 1].end).toBeGreaterThan(7000); // the last window sits near the end of the 2 h source
    for (const h of w) expect(h.end - h.start).toBeLessThanOrEqual(45);
    const few = jobs.ruleWindows(cues.slice(0, 30), settings);
    expect(few.length).toBeGreaterThan(3);
    expect(few.length).toBeLessThanOrEqual(jobs.RULE_WINDOWS_MAX);
  });
});

describe("R1321 copy-core", () => {
  test("draftCopy rewords the clip's own sentences, never invents; #shorts only for YouTube", () => {
    const c = draftCopy("Why nobody tells you this is the biggest mistake I see. Everyone plans tasks but nobody plans energy. You have maybe four good hours a day.", null, ["youtube"]);
    expect(c.title).toBe("Why nobody tells you this is the biggest mistake I see");
    expect(c.hook).toBe("Why nobody tells you this is the biggest mistake I see.");
    expect(c.caption).toContain("Everyone plans tasks");
    expect(c.hashtags).toContain("#shorts");
    expect(draftCopy("Plan the week.", "My title", ["instagram"]).title).toBe("My title");
    expect(hashtagsOf("plan the week plan the day", ["instagram"])).not.toContain("#shorts");
    expect(draftCopy("", null).title).toBe("A moment worth watching");
  });
});

/* ------------------------------------------------------------------ db */

describe("R1321 clipper service", () => {
  test("createJob is idempotent by clientKey, refuses bad sources and caps active jobs", async () => {
    const { user, media, actor } = await who();
    const a = await jobs.createJob(user.id, { mediaId: media.id, clientKey: "k1", settings: { target: 3 } }, actor);
    expect(a.created).toBe(true);
    expect(a.job.status).toBe("queued");
    expect(a.job.stage).toBe("transcribe");
    expect(a.job.settings.target).toBe(3);
    expect(a.job.durationSec).toBe(120);
    const b = await jobs.createJob(user.id, { mediaId: media.id, clientKey: "k1" }, actor);
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
    const another = await db.media.create({ data: { userId: user.id, originalFilename: "b.mp4", storageKey: `r1321/b-${a.job.id}.mp4`, mimeType: "video/mp4", size: 10, duration: 60, status: "ready" } });
    await expect(jobs.createJob(user.id, { mediaId: another.id, clientKey: "k1" }, actor)).rejects.toMatchObject({ status: 409, code: "KEY_IN_USE" });
    const short = await db.media.create({ data: { userId: user.id, originalFilename: "s.mp4", storageKey: `r1321/short-${a.job.id}.mp4`, mimeType: "video/mp4", size: 10, duration: 10, status: "ready" } });
    await expect(jobs.createJob(user.id, { mediaId: short.id }, actor)).rejects.toMatchObject({ status: 400, code: "BAD_SOURCE" });
    const c = await jobs.createJob(user.id, { mediaId: media.id, clientKey: "k2" }, actor);
    expect(c.created).toBe(true);
    expect(ACTIVE_JOBS_MAX).toBe(2);
    await expect(jobs.createJob(user.id, { mediaId: media.id, clientKey: "k3" }, actor)).rejects.toMatchObject({ status: 409, code: "TOO_MANY_JOBS" });
    // Cancel one and the cap opens again.
    const cancelled = await jobs.moveJob(user.id, c.job.id, "cancel", actor);
    expect(cancelled.status).toBe("cancelled");
    expect((await jobs.createJob(user.id, { mediaId: media.id, clientKey: "k3" }, actor)).created).toBe(true);
    const list = await jobs.listJobs(user.id);
    expect(list.map((j) => j.id)).toContain(a.job.id);
    expect(list.map((j) => j.id)).toContain(cancelled.id);
  });

  test("stage flow: start -> transcript -> rule detection -> approve -> edit makes the render stale -> render -> download", async () => {
    const { user, media, actor } = await who();
    const { job } = await jobs.createJob(user.id, { mediaId: media.id, settings: { platforms: ["instagram", "youtube"], minSec: 10, maxSec: 45, target: 4 } }, actor);
    const { words, cues } = talk();
    // Out of order: a transcript before start is a 409, not a silent overwrite.
    await expect(jobs.saveTranscript(user.id, job.id, { words }, actor)).rejects.toMatchObject({ status: 409 });
    const started = await jobs.moveJob(user.id, job.id, "start", actor, { executor: "browser" });
    expect(started.status).toBe("running");
    const hb = await jobs.heartbeat(user.id, job.id, 0.4);
    expect(hb.progress).toBe(0.4);
    // A second "start" from another tab is a no-op that keeps the progress.
    expect((await jobs.moveJob(user.id, job.id, "start", actor)).progress).toBe(0.4);
    await expect(jobs.saveTranscript(user.id, job.id, { words: [] }, actor)).rejects.toMatchObject({ status: 400, code: "EMPTY_TRANSCRIPT" });
    const t = await jobs.saveTranscript(user.id, job.id, { words, cues, language: "en", engine: "browser-whisper" }, actor);
    expect(t.wordCount).toBe(words.length);
    expect(t.cues).toBeGreaterThanOrEqual(cues.length); // normalizeCues splits lines that run long
    expect(t.job.stage).toBe("detect");
    expect(t.job.language).toBe("en");
    // Detect with no model: the rule detector, said plainly.
    await expect(jobs.detect(user.id, job.id, { ask: null, actor })).resolves.toMatchObject({ detector: "rules" });
    const detail = await jobs.jobDetail(user.id, job.id, { transcript: true });
    expect(detail.transcript?.cues.length).toBeGreaterThan(0);
    expect((await jobs.jobDetail(user.id, job.id)).transcript?.cues).toEqual([]); // polling view: no lines
    expect(detail.job.status).toBe("ready");
    expect(detail.job.stage).toBe("review");
    expect(detail.candidates.length).toBeGreaterThanOrEqual(3);
    expect(detail.candidates.length).toBeLessThanOrEqual(12);
    expect(detail.candidates.map((c) => c.rank)).toEqual(detail.candidates.map((_, i) => i + 1));
    for (const c of detail.candidates) {
      expect(c.end - c.start).toBeGreaterThanOrEqual(10);
      expect(c.end - c.start).toBeLessThanOrEqual(45);
      expect(c.reason.length).toBeGreaterThan(10);
      expect(c.source).toBe("ai");
      expect(c.status).toBe("suggested");
    }
    // A model that throws also falls back to rules, and replaces the suggested set instead of doubling it.
    const again = await jobs.detect(user.id, job.id, { ask: async () => { throw new Error("down"); }, actor }).catch((e) => e);
    expect(again).toMatchObject({ status: 409 }); // not at the detect stage any more
    // Cut by text adds "text" candidates where the phrase is said.
    const byText = await jobs.addTextCandidates(user.id, job.id, "paper notebook", actor);
    expect(byText.added.length).toBe(1);
    expect(byText.added[0].source).toBe("text");
    expect(byText.added[0].kind).toBe("text");
    expect((await jobs.addTextCandidates(user.id, job.id, "paper notebook", actor)).added).toEqual([]); // same place: not twice
    const none = await jobs.addTextCandidates(user.id, job.id, "quantum physics", actor);
    expect(none.added).toEqual([]);
    expect(none.missing).toEqual(["quantum physics"]);
    // Approve (once) and reject.
    const first = detail.candidates[0];
    const ap = await jobs.approveCandidate(user.id, first.id, actor);
    expect(ap.created).toBe(true);
    expect(ap.clip.status).toBe("approved");
    expect(ap.clip.renderStatus).toBe("pending");
    expect(ap.clip.title.length).toBeGreaterThan(0);
    expect(ap.clip.hook.length).toBeGreaterThan(0);
    expect(ap.clip.hashtags).toContain("#shorts");
    expect(ap.clip.reframe).toEqual(DEFAULT_REFRAME);
    expect((await jobs.approveCandidate(user.id, first.id, actor)).created).toBe(false);
    const rj = await jobs.rejectCandidate(user.id, detail.candidates[1].id, actor);
    expect(rj.status).toBe("rejected");
    // Manual clip inside the video; outside is refused.
    const manual = await jobs.createManualClip(user.id, job.id, { start: 100, end: 118, title: "Paper" }, actor);
    expect(manual.title).toBe("Paper");
    await expect(jobs.createManualClip(user.id, job.id, { start: 110, end: 130 }, actor)).rejects.toMatchObject({ status: 400 });
    // Render, then an edit to the reframe makes it stale; a title edit does not.
    const rendered = await db.media.create({ data: { userId: user.id, originalFilename: "clip.webm", storageKey: `r1321/render-${ap.clip.id}.webm`, mimeType: "video/webm", size: 5_000, duration: 30, width: 1080, height: 1920, status: "ready" } });
    expect((await jobs.reportRender(user.id, ap.clip.id, { status: "rendering", executor: "browser" }, actor)).renderStatus).toBe("rendering");
    const done = await jobs.reportRender(user.id, ap.clip.id, { status: "rendered", mediaId: rendered.id }, actor);
    expect(done.renderStatus).toBe("rendered");
    expect(done.mediaId).toBe(rendered.id);
    const dl = await jobs.clipDownload(user.id, ap.clip.id);
    expect(dl.media.id).toBe(rendered.id);
    const retitled = await jobs.updateClip(user.id, ap.clip.id, { title: "A better title" }, actor);
    expect(retitled.title).toBe("A better title");
    expect(retitled.renderStatus).toBe("rendered");
    const moved = await jobs.updateClip(user.id, ap.clip.id, { reframe: { mode: "crop", x: 0.2 } }, actor);
    expect(moved.renderStatus).toBe("pending");
    expect(moved.mediaId).toBeNull();
    expect(moved.reframe).toEqual({ mode: "crop", x: 0.2, y: 0.5 });
    await expect(jobs.clipDownload(user.id, ap.clip.id)).rejects.toMatchObject({ status: 409, code: "NOT_RENDERED" });
    // A "rendered" report for a render that started before the edit is stale: refused, the clip stays pending.
    await expect(jobs.reportRender(user.id, ap.clip.id, { status: "rendered", mediaId: rendered.id }, actor)).rejects.toMatchObject({ status: 409, code: "STALE_RENDER" });
    expect((await jobs.ownedClip(user.id, ap.clip.id)).renderStatus).toBe("pending");
    await jobs.reportRender(user.id, ap.clip.id, { status: "rendering" }, actor);
    // The source video and a trashed file are not renders.
    await expect(jobs.reportRender(user.id, ap.clip.id, { status: "rendered", mediaId: media.id }, actor)).rejects.toMatchObject({ status: 400, code: "BAD_RENDER" });
    const binned = await db.media.create({ data: { userId: user.id, originalFilename: "t.webm", storageKey: `r1321/bin-${ap.clip.id}.webm`, mimeType: "video/webm", size: 10, status: "ready", deletedAt: new Date() } });
    await expect(jobs.reportRender(user.id, ap.clip.id, { status: "rendered", mediaId: binned.id }, actor)).rejects.toMatchObject({ status: 400, code: "BAD_RENDER" });
    // A photo is not a render.
    const photo = await db.media.create({ data: { userId: user.id, originalFilename: "p.jpg", storageKey: `r1321/photo-${ap.clip.id}.jpg`, mimeType: "image/jpeg", size: 10, status: "ready" } });
    await expect(jobs.reportRender(user.id, ap.clip.id, { status: "rendered", mediaId: photo.id }, actor)).rejects.toMatchObject({ status: 400, code: "BAD_RENDER" });
    // The same file cannot be two clips' render.
    const fresh = await db.media.create({ data: { userId: user.id, originalFilename: "c2.webm", storageKey: `r1321/render2-${ap.clip.id}.webm`, mimeType: "video/webm", size: 10, status: "ready" } });
    const second = await jobs.reportRender(user.id, ap.clip.id, { status: "rendered", mediaId: fresh.id }, actor);
    expect(second.renderStatus).toBe("rendered");
    await jobs.reportRender(user.id, manual.id, { status: "rendering" }, actor);
    await expect(jobs.reportRender(user.id, manual.id, { status: "rendered", mediaId: fresh.id }, actor)).rejects.toMatchObject({ status: 409, code: "MEDIA_IN_USE" });
    // Regenerate copy after a hand edit, then discard; the review closes the job.
    const regen = await jobs.regenerateCopy(user.id, ap.clip.id, actor);
    expect(regen.title).not.toBe("A better title");
    const gone = await jobs.discardClip(user.id, manual.id, actor);
    expect(gone.status).toBe("discarded");
    await expect(jobs.updateClip(user.id, manual.id, { title: "x" }, actor)).rejects.toMatchObject({ status: 409, code: "DISCARDED" });
    const closed = await jobs.moveJob(user.id, job.id, "reviewed", actor);
    expect(closed.stage).toBe("done");
    expect(closed.completedAt).not.toBeNull();
    // The audit trail reads back what happened to the clip.
    const events = await jobs.clipEvents(user.id, ap.clip.id);
    const types = events.map((e) => e.type);
    for (const t2 of ["approved", "render_rendering", "render_rendered", "edited"]) expect(types).toContain(t2);
    expect(events.every((e) => e.actorId === user.id)).toBe(true);
  });

  test("failure and retry; a cancelled job is final", async () => {
    const { user, media, actor } = await who();
    const { job } = await jobs.createJob(user.id, { mediaId: media.id }, actor);
    await jobs.moveJob(user.id, job.id, "start", actor);
    const failed = await jobs.failJob(user.id, job.id, "the tab closed", actor);
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("the tab closed");
    expect(stageWords(failed)).toBe("Stopped: the tab closed");
    const retried = await jobs.moveJob(user.id, job.id, "retry", actor);
    expect(retried.status).toBe("queued");
    expect(retried.error).toBeNull();
    await jobs.moveJob(user.id, job.id, "cancel", actor);
    await expect(jobs.moveJob(user.id, job.id, "start", actor)).rejects.toMatchObject({ status: 409 });
  });

  test("tenant isolation: another owner sees nothing, and cannot report a render with their own media", async () => {
    const a = await who();
    const b = await who();
    const { job } = await jobs.createJob(a.user.id, { mediaId: a.media.id }, a.actor);
    await expect(jobs.ownedJob(b.user.id, job.id)).rejects.toMatchObject({ status: 404 });
    await expect(jobs.jobDetail(b.user.id, job.id)).rejects.toMatchObject({ status: 404 });
    await expect(jobs.moveJob(b.user.id, job.id, "cancel", b.actor)).rejects.toMatchObject({ status: 404 });
    await expect(jobs.createJob(b.user.id, { mediaId: a.media.id }, b.actor)).rejects.toMatchObject({ status: 404 });
    expect((await jobs.listJobs(b.user.id)).map((j) => j.id)).not.toContain(job.id);
    await jobs.moveJob(a.user.id, job.id, "start", a.actor);
    const { words, cues } = talk();
    await jobs.saveTranscript(a.user.id, job.id, { words, cues }, a.actor);
    await jobs.detect(a.user.id, job.id, { ask: null, actor: a.actor });
    const d = await jobs.jobDetail(a.user.id, job.id);
    const { clip } = await jobs.approveCandidate(a.user.id, d.candidates[0].id, a.actor);
    await expect(jobs.approveCandidate(b.user.id, d.candidates[1].id, b.actor)).rejects.toMatchObject({ status: 404 });
    await expect(jobs.updateClip(b.user.id, clip.id, { title: "mine" }, b.actor)).rejects.toMatchObject({ status: 404 });
    await expect(jobs.reportRender(a.user.id, clip.id, { status: "rendered", mediaId: b.media.id }, a.actor)).rejects.toMatchObject({ status: 404 });
    await expect(jobs.clipEvents(b.user.id, clip.id)).rejects.toMatchObject({ status: 404 });
  });
});

/* ------------------------------------------------------------------ wiring */

describe("R1321 wiring", () => {
  test("schema has the five models with owner scoping and cascades", () => {
    const schema = read("prisma/schema.template.prisma");
    for (const m of ["ClipJob", "ClipTranscript", "ClipCandidate", "GeneratedClip", "ClipEvent"]) expect(schema).toContain(`model ${m} {`);
    expect(schema).toContain("@@unique([ownerId, clientKey])");
    expect(schema).toMatch(/model ClipTranscript[\s\S]*?onDelete: Cascade/);
    expect(schema).toMatch(/model GeneratedClip[\s\S]*?postId\s+String\?\s+@unique/);
    expect(schema).toMatch(/model ClipJob[\s\S]*?media\s+Media\?\s+@relation\(fields: \[mediaId\], references: \[id\], onDelete: SetNull\)/); // purging the source keeps the clips
    expect(read("prisma/schema.prisma")).toContain("model GeneratedClip {");
  });
  test("routes exist and go through route(); pure cores never touch the database", () => {
    const routes = [
      "app/api/clipper/jobs/route.ts",
      "app/api/clipper/jobs/[id]/route.ts",
      "app/api/clipper/jobs/[id]/stage/route.ts",
      "app/api/clipper/jobs/[id]/detect/route.ts",
      "app/api/clipper/jobs/[id]/candidates/route.ts",
      "app/api/clipper/jobs/[id]/clips/route.ts",
      "app/api/clipper/jobs/[id]/cancel/route.ts",
      "app/api/clipper/candidates/[id]/route.ts",
      "app/api/clipper/clips/[id]/route.ts",
      "app/api/clipper/clips/[id]/render/route.ts",
      "app/api/clipper/clips/[id]/regenerate/route.ts",
      "app/api/clipper/clips/[id]/download/route.ts",
      "app/api/clipper/clips/[id]/events/route.ts",
    ];
    for (const r of routes) {
      expect(has(r)).toBe(true);
      const src = read(r);
      expect(src).toContain("from \"@/lib/http\"");
      expect(src).toContain("route(");
      expect(src).toContain("limit: [");
    }
    for (const core of ["settings-core", "reframe-core", "candidates-core", "copy-core"]) {
      const src = read(`lib/clipper/${core}.ts`);
      expect(src).not.toContain("@/lib/db");
      expect(src).not.toContain("prisma");
    }
    expect(read("lib/clipper/jobs.ts")).toContain('import "server-only"');
    const detectSrc = read("app/api/clipper/jobs/[id]/detect/route.ts");
    expect(detectSrc).toContain("activeAiGrant");
    expect(detectSrc.indexOf("ownedJob(")).toBeLessThan(detectSrc.indexOf("chargeAi(")); // the stage check comes before any charge
    expect(read("app/api/clipper/jobs/[id]/stage/route.ts")).toContain("max(1)"); // heartbeat progress is a fraction
    expect(read("app/api/clipper/jobs/[id]/clips/route.ts")).toContain("ownerId: user.id");
  });
  test("account deletion clears clipper rows; docs name the round", () => {
    const acc = read("lib/account.ts");
    expect(acc).toContain("db.clipJob.deleteMany({ where: { ownerId: me.id } })");
    expect(acc).toContain("db.clipEvent.deleteMany({ where: { ownerId: me.id } })");
    expect(read("lib/clipper/README.md")).toContain("R1321");
    expect(read("docs/intelligence-clipper-plan.md")).toContain("R1321");
  });
});
