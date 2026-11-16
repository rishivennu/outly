import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { barState, type BarInput } from "../components/create/ActionBar";
import { donePercent, stepIndex, stepStates } from "../components/create/step-states";
import { fileKey, fileStatus, limitFacts, uniqueFiles } from "../components/create/UploadCard";
import { draftName, savedAgo } from "../components/create/SavedDrafts";
import { PANEL_OPEN, PIP_PANEL_KEY, panelReducer } from "../components/create/assistant-state";
import { batchProgress } from "../components/create/BulkPlanner";
import { handoffBatch, takeBatch } from "../lib/client/handoff";
import type { UploadLimits } from "../lib/client/upload";
import type { Step } from "../components/create/types";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const all: Record<Step, boolean> = { video: true, story: true, everywhere: true, launch: true };
const none: Record<Step, boolean> = { video: true, story: false, everywhere: false, launch: false };
const base: BarInput = { online: true, hasMedia: true, uploadFailed: false, hasHook: true, ready: true, enabledCount: 1, launching: false, saving: false };
const MB = 1048576;
const lim = (o: Partial<UploadLimits> = {}): UploadLimits => ({ direct: true, maxBytes: 500 * MB, maxMb: 500, ...o });

describe("step progress", () => {
  test("four steps in order, the current one marked, later ones locked until reachable", () => {
    expect(["video", "story", "everywhere", "launch"].map((s) => stepIndex(s as Step))).toEqual([0, 1, 2, 3]);
    const s = stepStates("video", undefined, none);
    expect(s.map((x) => x.state)).toEqual(["current", "blocked", "blocked", "blocked"]);
    expect(s.every((x) => !x.canGo)).toBe(true);
  });
  test("steps passed stay done after going back, and can be revisited", () => {
    const s = stepStates("story", "launch", all);
    expect(s.map((x) => x.state)).toEqual(["done", "current", "done", "upcoming"]); // reached Launch but not sent it
    expect(s.map((x) => x.canGo)).toEqual([true, false, true, true]);
  });
  test("a sent post shows every step done and nothing clickable", () => {
    const s = stepStates("launch", "launch", all, true);
    expect(s.every((x) => x.state === "done" && !x.canGo)).toBe(true);
    expect(donePercent("launch", true)).toBe(100);
  });
  test("percent done counts finished steps", () => {
    expect(donePercent("video")).toBe(0);
    expect(donePercent("story")).toBe(25);
    expect(donePercent("launch")).toBe(75);
  });
});

describe("picking files", () => {
  test("the same file twice is kept once", () => {
    const a = { name: "a.mp4", size: 10, lastModified: 1 };
    const b = { name: "b.mp4", size: 10, lastModified: 1 };
    expect(fileKey(a)).toBe("a.mp4:10:1");
    expect(uniqueFiles([a, b, { ...a }])).toEqual({ files: [a, b], dropped: 1 });
    expect(uniqueFiles([]).dropped).toBe(0);
  });
  test("limits come from the server; nothing is claimed before they arrive", () => {
    const f = limitFacts(null);
    expect(f.size).toBeNull();
    expect(f.storage).toBeNull();
    expect(f.full).toBe(false);
    expect(limitFacts(lim()).size).toBe("Up to 500 MB per file");
  });
  test("storage shows only when the plan has a cap, and a full one says so", () => {
    expect(limitFacts(lim({ storage: { limitBytes: 0, remainingBytes: 0, over: false, label: "" } })).storage).toBeNull();
    const left = limitFacts(lim({ storage: { limitBytes: 10 * 1024 * MB, remainingBytes: 2 * 1024 * MB, over: false, label: "10 GB" } }));
    expect(left.storage).toContain("of 10 GB left");
    expect(left.full).toBe(false);
    const full = limitFacts(lim({ storage: { limitBytes: 10 * 1024 * MB, remainingBytes: 0, over: true, label: "10 GB" } }));
    expect(full.storage).toBe("Storage full (10 GB)");
    expect(full.full).toBe(true);
  });
  test("the file row never says Uploaded before the server has the file", () => {
    expect(fileStatus({ kind: "uploading", progress: 0.42 }).text).toStartWith("Uploading 42%");
    expect(fileStatus({ kind: "paused", progress: 0.5 }).text).toBe("Paused at 50%");
    expect(fileStatus({ kind: "failed", message: "Too big" }).text).toBe("Too big");
    expect(fileStatus({ kind: "failed", message: "Too big" }, false).text).toContain("Waiting for a connection");
    expect(fileStatus({ kind: "idle" }).text).not.toBe("Uploaded");
    for (const u of [{ kind: "uploading", progress: 1 }, { kind: "paused", progress: 1 }, { kind: "idle" }] as const) expect(fileStatus(u).text).not.toContain("Uploaded");
    expect(fileStatus({ kind: "done" })).toEqual({ tone: "ok", text: "Uploaded" });
  });
});

describe("Step 1 action bar", () => {
  test("Continue waits for the upload, says why, and shows the percent", () => {
    const up = barState({ ...base, step: "video", upload: "uploading", progress: 0.3 });
    expect(up.buttons.at(-1)!.disabled).toBe(true);
    expect(up.note).toContain("uploading (30%)");
    const paused = barState({ ...base, step: "video", upload: "paused" });
    expect(paused.note).toBe("Your upload is paused. Resume it to continue.");
    const failed = barState({ ...base, step: "video", upload: "failed" });
    expect(failed.buttons.at(-1)!.disabled).toBe(true);
    expect(failed.note).toContain("didn't upload");
  });
  test("after visiting the story once, an upload in flight no longer blocks going back to it", () => {
    const s = barState({ ...base, step: "video", upload: "uploading", progress: 0.3, storySeen: true });
    expect(s.buttons.at(-1)!.disabled).toBe(false);
  });
  test("done enables Continue; moving shows a loading label", () => {
    expect(barState({ ...base, step: "video", upload: "done" }).buttons.at(-1)!.disabled).toBe(false);
    const m = barState({ ...base, step: "video", upload: "done", moving: true });
    expect(m.buttons.at(-1)!.label).toBe("Opening your story");
    expect(m.buttons.at(-1)!.disabled).toBe(true);
  });
});

describe("batch handoff", () => {
  test("several videos go to the planner once", () => {
    const f = [new File(["a"], "a.mp4"), new File(["b"], "b.mp4")];
    handoffBatch(f);
    expect(takeBatch().map((x) => x.name)).toEqual(["a.mp4", "b.mp4"]);
    expect(takeBatch()).toEqual([]);
  });
  test("batch progress weighs by size and counts ready and failed", () => {
    const row = (state: string, size: number, progress = 0) => ({ state, progress, file: { size } }) as Parameters<typeof batchProgress>[0][number];
    expect(batchProgress([row("ready", 100), row("uploading", 100, 0.5), row("failed", 200)])).toEqual({ ready: 1, failed: 1, total: 3, pct: 38 });
    expect(batchProgress([row("ready", 1), row("ready", 1)]).pct).toBe(100);
  });
});

describe("Pip panel memory", () => {
  test("the saved choice is applied and step changes keep it", () => {
    const closed = panelReducer(PANEL_OPEN, { t: "set", open: false });
    expect(closed).toEqual({ open: false, restore: null });
    expect(panelReducer(closed, { t: "set", open: false })).toBe(closed);
    expect(panelReducer(closed, { t: "step", step: "launch" })).toBe(closed);
    expect(PIP_PANEL_KEY).toBe("outlly:pip-panel");
  });
});

describe("saved drafts", () => {
  test("a draft is named by title, then hook, then file", () => {
    expect(draftName({ title: " Trip ", hook: "h", media: null })).toBe("Trip");
    expect(draftName({ title: "", hook: "My hook", media: null })).toBe("My hook");
    expect(draftName({ title: null, hook: null, media: { filename: "clip.mp4" } } as never)).toBe("clip.mp4");
    expect(draftName({ title: null, hook: null, media: null } as never)).toBe("Untitled draft");
  });
  test("saved time reads plainly", () => {
    const now = Date.parse("2026-11-16T12:00:00Z");
    const ago = (min: number) => savedAgo(new Date(now - min * 60000).toISOString(), now);
    expect(ago(0)).toBe("Saved just now");
    expect(ago(5)).toBe("Saved 5 min ago");
    expect(ago(180)).toBe("Saved 3 h ago");
    expect(ago(60 * 24)).toBe("Saved yesterday");
    expect(ago(60 * 24 * 4)).toBe("Saved 4 days ago");
  });
});

describe("workspace wiring", () => {
  const ws = src("components/create/CreateWorkspace.tsx");
  test("Step 1 heading, upload card, saved drafts and the bar fill", () => {
    expect(ws).toContain("Let&apos;s start with <span");
    expect(ws).toContain('data-testid="step-one"');
    expect(ws).toContain("<SavedDrafts");
    expect(ws).toContain("fill={stepOne}");
  });
  test("picking no longer jumps to the story; several files go to the planner", () => {
    expect(ws).not.toContain('setStep((s) => (s === "video" ? "story" : s))');
    expect(ws).toContain("handoffBatch(list.slice(0, BULK_MAX))");
    expect(ws).toContain('router.push("/create/bulk")');
    expect(src("components/create/BulkPlanner.tsx")).toContain("takeBatch()");
  });
  test("the Pip panel choice is remembered in this browser", () => {
    expect(ws.match(/PIP_PANEL_KEY/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
  test("no em dashes in the new 1170 files", () => {
    for (const f of ["components/create/StepProgress.tsx", "components/create/UploadCard.tsx", "components/create/SavedDrafts.tsx", "components/create/CreateWorkspace.tsx", "components/create/BulkPlanner.tsx"]) {
      expect(src(f)).not.toContain("\u2014");
    }
  });
});

describe("review fixes", () => {
  const ws = src("components/create/CreateWorkspace.tsx");
  test("a paused upload closes Everywhere and Launch too, and blocks save and send", () => {
    expect(ws).toContain("everywhere: storyOpen && !!hook, launch: storyOpen && !!hook && allReviewed");
    const s = barState({ ...base, step: "launch", upload: "paused" });
    expect(s.note).toBe("Your upload is paused. Resume it on Your Video first.");
    expect(s.buttons.at(-1)!.disabled).toBe(true);
    expect(barState({ ...base, step: "story", upload: "paused" }).save.disabled).toBe(true);
    expect(barState({ ...base, step: "story", upload: "done" }).save.disabled).toBe(false);
  });
  test("resume keeps the poster and Pip's read, and starts from the paused point", () => {
    expect(ws).toContain("void startUpload(fileRef.current, localUrl ?? undefined, { progress: upload.progress })");
    expect(ws).toContain("onResume={upload.kind === \"paused\" && fileRef.current ? resumeUpload : undefined}");
    expect(ws).toContain("if (!resume) readVideo(url)");
  });
  test("a stale batch is dropped", () => {
    handoffBatch([new File(["a"], "a.mp4")]);
    expect(takeBatch(Date.now() + 61_000)).toEqual([]);
  });
  test("the page never lets the browser open a dropped file, and a paused upload warns before leaving", () => {
    expect(ws).toContain('window.addEventListener("drop", guard);');
    expect(ws).toContain('if (upload.kind !== "uploading" && upload.kind !== "paused") return;');
    expect(src("components/create/UploadCard.tsx")).toContain("aria-valuetext={st.text}");
  });
});
