/**
 * Phase 4 (items 3 and 8): the caption run lives in a workspace store, so it keeps going when the editor
 * unmounts (step change) and its lines still reach the draft; one shift moves every line on both tracks
 * when shown, burned or exported, without touching the stored times. Transport is stubbed here (the store
 * takes its fetchers as deps); the product path uses the real ones.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createCaptionStore, runLine, runPill, trackOf, type Deps } from "../components/create/captions/run-store";
import { clampOffset, exportCues, offsetCues, offsetWords, sayOffset, showOffset, stepOffset } from "../lib/captions/offset";
import { readTrack, type CaptionTrack } from "../lib/captions/edit";
import type { Cue } from "../lib/captions/cues";
import type { AudioChunk, ChunkAnswer } from "../lib/client/captions";

const chunk = (index: number, from: number, to: number): AudioChunk => ({ index, offset: from, duration: to - from, from, to, blob: new Blob([]) });
const words = (from: number, list: string[]) => list.map((w, i) => ({ w, s: from + i * 0.5, e: from + i * 0.5 + 0.4 }));
const tick = () => new Promise((r) => setTimeout(r, 0));

function rig(opts: { gate?: Promise<void>; fail?: number[]; hold?: { index: number; until: Promise<void> }; silent?: number[] } = {}) {
  const calls: { lang?: string; ref: string }[] = [];
  let burned: { cues: Cue[] } | null = null;
  const deps: Partial<Deps> = {
    audioChunks: async () => [chunk(0, 0, 5), chunk(1, 5, 10)].map((c) => ({ ...c, silent: opts.silent?.includes(c.index) })),
    postChunk: async (c, q, signal) => {
      calls.push(q);
      if (opts.gate) await opts.gate;
      if (opts.hold?.index === c.index) await opts.hold.until;
      if (signal.aborted) throw Object.assign(new Error("stopped"), { name: "AbortError" });
      if (opts.fail?.includes(c.index)) throw new Error("no answer");
      return { words: words(c.from, ["one", "two", "three"]), language: "te" } satisfies ChunkAnswer;
    },
    api: (async (url: string, init?: { json?: { cues: Cue[] } }) => {
      if (url === "/api/ai/translate-captions") return { cues: init!.json!.cues.map((c) => ({ ...c, text: `EN ${c.text}` })), untranslated: [] };
      return {};
    }) as Deps["api"],
    burnCaptions: (async (_src: string, cues: Cue[]) => {
      burned = { cues };
      return new File([], "x-captions.mp4");
    }) as Deps["burnCaptions"],
    offerUpgrade: () => {},
    runId: () => "run-1",
  };
  const store = createCaptionStore(deps);
  const tracks: (CaptionTrack | null)[] = [];
  store.attach({ key: "media-1", src: "blob:x", filename: "clip.mp4", duration: 10 });
  store.setHandlers({ onTrackChange: (t) => tracks.push(t), onBurned: () => {}, onError: () => {} });
  store.set({ on: true });
  return { store, tracks, calls, burned: () => burned };
}

describe("p4 caption run store", () => {
  test("a run reports parts, lands its lines in the draft and ends Done, with no editor mounted", async () => {
    const { store, tracks } = rig();
    const seen: string[] = [];
    store.subscribe(() => {
      const p = runPill(store.getState());
      if (p && seen[seen.length - 1] !== p) seen.push(p);
    });
    await store.transcribe();
    expect(seen).toContain("Transcribing, 1 of 2 parts");
    expect(seen[seen.length - 1]).toBe("Done");
    const s = store.getState();
    expect(s.busy).toBeNull();
    expect(s.tracks.orig.length).toBeGreaterThan(0);
    expect(s.heard).toBe("te");
    const last = tracks[tracks.length - 1]!;
    expect(last.cues).toEqual(s.tracks.orig);
    expect(last.lang).toBe("te");
  });

  test("progressive: a part's lines show as soon as it lands, and a line edited mid-run survives the end", async () => {
    let open!: () => void;
    const until = new Promise<void>((r) => (open = r));
    const { store, tracks } = rig({ hold: { index: 1, until } });
    const p = store.transcribe();
    for (let i = 0; i < 20 && !store.getState().tracks.orig.length; i++) await tick();
    const mid = store.getState();
    expect(mid.busy).not.toBeNull();
    expect(mid.tracks.orig.length).toBeGreaterThan(0);
    expect(mid.tracks.orig.every((c) => c.end <= 5.5)).toBe(true);
    expect(mid.heard).toBe("te");
    expect(runPill(mid)).toBe("Transcribing, 1 of 2 parts");
    expect(tracks.length).toBeGreaterThan(0);
    store.setCues((cs) => cs.map((c, i) => (i === 0 ? { ...c, text: "fixed while waiting" } : c)));
    open();
    await p;
    const s = store.getState();
    expect(s.busy).toBeNull();
    expect(s.tracks.orig[0].text).toBe("fixed while waiting");
    expect(s.tracks.orig.some((c) => c.start >= 5)).toBe(true);
  });

  test("Stop mid-run keeps the parts that landed and lists the rest to retry", async () => {
    let open!: () => void;
    const until = new Promise<void>((r) => (open = r));
    const { store } = rig({ hold: { index: 1, until } });
    const p = store.transcribe();
    for (let i = 0; i < 20 && !store.getState().tracks.orig.length; i++) await tick();
    store.stop();
    open();
    await p;
    const s = store.getState();
    expect(s.outcome).toBe("stopped");
    expect(s.tracks.orig.length).toBeGreaterThan(0);
    expect(s.tracks.orig.every((c) => c.end <= 5.5)).toBe(true);
    expect(s.gaps.map((g) => g.index)).toEqual([1]);
    expect(s.note).toBe("Stopped with 1 of 2 parts back. Retry the rest below.");
    await store.transcribe([1]);
    const r = store.getState();
    expect(r.gaps).toEqual([]);
    expect(r.tracks.orig.some((c) => c.start >= 5)).toBe(true);
    expect(r.tracks.orig.some((c) => c.end <= 5)).toBe(true);
  });

  test("a re-run keeps the English track in step while parts land", async () => {
    const hold = { index: -1, until: Promise.resolve() };
    const { store } = rig({ hold });
    await store.transcribe();
    await store.translate();
    expect(store.getState().tracks.view).toBe("english");
    let open!: () => void;
    hold.until = new Promise<void>((r) => (open = r));
    hold.index = 1;
    const p = store.transcribe();
    for (let i = 0; i < 20 && store.getState().busy?.kind !== "transcribe"; i++) await tick();
    for (let i = 0; i < 20 && store.getState().busy?.kind === "transcribe" && (store.getState().busy as { done: number }).done < 1; i++) await tick();
    const mid = store.getState();
    expect(mid.busy).toEqual({ kind: "transcribe", done: 1, total: 2 });
    expect(mid.tracks.view).toBe("english");
    expect(mid.tracks.en!.length).toBe(mid.tracks.orig.length);
    expect(mid.tracks.en!.map((c) => [c.start, c.end])).toEqual(mid.tracks.orig.map((c) => [c.start, c.end]));
    expect(mid.tracks.en!.every((c) => c.text.startsWith("EN "))).toBe(true);
    open();
    await p;
    expect(store.getState().busy).toBeNull();
  });

  test("a silent part is never sent to the AI; a video that is all silence says no speech was heard", async () => {
    const one = rig({ silent: [1] });
    await one.store.transcribe();
    expect(one.calls.length).toBe(1);
    expect(one.store.getState().tracks.orig.every((c) => c.end <= 5.5)).toBe(true);
    const none = rig({ silent: [0, 1] });
    await none.store.transcribe();
    expect(none.calls.length).toBe(0);
    expect(none.store.getState().tracks.orig).toEqual([]);
    expect(none.store.getState().note).toContain("We didn't hear any speech");
  });

  test("Stop ends the run as Stopped and keeps the lines you had", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const { store } = rig({ gate });
    store.setCues([{ start: 0, end: 1, text: "mine" }]);
    const p = store.transcribe();
    await tick();
    expect(runLine(store.getState())).toContain("They keep going on every step; a reload stops them.");
    store.stop();
    open();
    await p;
    expect(store.getState().outcome).toBe("stopped");
    expect(runPill(store.getState())).toBe("Stopped");
    expect(store.getState().tracks.orig).toEqual([{ start: 0, end: 1, text: "mine" }]);
    store.ack();
    expect(runPill(store.getState())).toBeNull();
  });

  test("the same video mounting again carries on; another video stops the old run and starts clean", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const { store } = rig({ gate });
    const p = store.transcribe();
    await tick();
    expect(store.attach({ key: "media-1", src: "blob:x", filename: "clip.mp4", duration: 10 })).toBe(false);
    expect(store.getState().busy?.kind).toBe("transcribe");
    expect(store.attach({ key: "media-2", src: "blob:y", filename: "other.mp4", duration: 8, initialTrack: { cues: [{ start: 1, end: 2, text: "kept" }], style: "box", pos: "top" } })).toBe(true);
    open();
    await p;
    const s = store.getState();
    expect(s.key).toBe("media-2");
    expect(s.busy).toBeNull();
    expect(s.tracks.orig.map((c) => c.text)).toEqual(["kept"]);
    expect(s.style).toBe("box");
  });

  test("lines edited while chunks are out are kept on a retry of a failed part", async () => {
    const { store } = rig({ fail: [1] });
    await store.transcribe();
    expect(store.getState().gaps.map((g) => g.index)).toEqual([1]);
    expect(runPill(store.getState())).toBe("Needs a look");
    store.setCues((cs) => cs.map((c, i) => (i === 0 ? { ...c, text: "edited" } : c)));
    await store.transcribe([1]);
    const s = store.getState();
    expect(s.gaps.length).toBe(1);
    expect(s.tracks.orig[0].text).toBe("edited");
  }, 15000);

  test("translate lands the English track on the same times", async () => {
    const { store } = rig();
    await store.transcribe();
    await store.translate();
    const s = store.getState();
    expect(s.tracks.view).toBe("english");
    expect(s.tracks.en!.map((c) => [c.start, c.end])).toEqual(s.tracks.orig.map((c) => [c.start, c.end]));
    expect(s.tracks.en![0].text.startsWith("EN ")).toBe(true);
  });

  test("burn gets the shifted lines; the stored lines and the draft keep their times plus the offset", async () => {
    const { store, tracks, burned } = rig();
    store.setCues([{ start: 1, end: 2, text: "a" }, { start: 9, end: 9.8, text: "b" }]);
    store.setOffset(0.5);
    await store.burn(store.getState().tracks.orig);
    expect(burned()!.cues).toEqual([{ start: 1.5, end: 2.5, text: "a" }, { start: 9.5, end: 10, text: "b" }]);
    expect(store.getState().tracks.orig[0]).toEqual({ start: 1, end: 2, text: "a" });
    expect(store.getState().burned).toBe(true);
    expect(tracks[tracks.length - 1]!.offset).toBe(0.5);
  });

  test("dispose stops a run and drops the callbacks", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const { store, tracks } = rig({ gate });
    const p = store.transcribe();
    await tick();
    const before = tracks.length;
    store.dispose();
    open();
    await p;
    expect(tracks.length).toBe(before);
  });

  test("trackOf: off or empty is null", () => {
    const { store } = rig();
    expect(trackOf(store.getState())).toBeNull();
    store.set({ on: false });
    store.setCues([{ start: 0, end: 1, text: "x" }]);
    expect(trackOf(store.getState())).toBeNull();
  });
});

describe("p4 caption shift", () => {
  const cues: Cue[] = [{ start: 0.2, end: 1, text: "a" }, { start: 1, end: 2, text: "b" }, { start: 9.6, end: 10, text: "c" }];
  test("clamped to -2.0..+2.0 on the 0.1 grid", () => {
    expect(clampOffset(3)).toBe(2);
    expect(clampOffset(-2.04)).toBe(-2);
    expect(clampOffset("0.26")).toBe(0.3);
    expect(clampOffset("x")).toBe(0);
    expect(clampOffset(-0.04)).toBe(0);
    expect(stepOffset(1.9, 1)).toBe(2);
    expect(stepOffset(2, 1)).toBe(2);
    expect(stepOffset(-0.1, 1)).toBe(0);
    expect(stepOffset(0.3, -1)).toBe(0.2);
  });
  test("shown as a signed value and spoken plainly", () => {
    expect(showOffset(0.3)).toBe("+0.3 s");
    expect(showOffset(-1.2)).toBe("-1.2 s");
    expect(showOffset(0)).toBe("0.0 s");
    expect(sayOffset(-0.5)).toBe("0.5 seconds earlier");
    expect(sayOffset(0)).toBe("No shift");
  });
  test("offsetCues keeps count and order and stays inside the clip", () => {
    expect(offsetCues(cues, 0, 10)).toBe(cues);
    const late = offsetCues(cues, 0.5, 10);
    expect(late.length).toBe(3);
    expect(late[0]).toEqual({ start: 0.7, end: 1.5, text: "a" });
    expect(late[2]).toEqual({ start: 10, end: 10, text: "c" });
    const early = offsetCues(cues, -0.5, 10);
    expect(early[0]).toEqual({ start: 0, end: 0.5, text: "a" });
  });
  test("exportCues drops a line pushed off the clip; words move with the lines", () => {
    expect(exportCues(cues, 0.5, 10).map((c) => c.text)).toEqual(["a", "b"]);
    expect(offsetWords([{ w: "hi", s: 1, e: 1.4 }, { w: "end", s: 9.8, e: 10 }], 0.4, 10)).toEqual([{ w: "hi", s: 1.4, e: 1.8 }]);
  });
  test("a draft keeps the shift; junk or zero is dropped", () => {
    const c = [{ start: 0, end: 1, text: "a" }];
    expect(readTrack({ cues: c, offset: -0.7 })!.offset).toBe(-0.7);
    expect(readTrack({ cues: c, offset: 9 })!.offset).toBe(2);
    expect("offset" in readTrack({ cues: c, offset: "nope" })!).toBe(false);
    expect("offset" in readTrack({ cues: c, offset: 0 })!).toBe(false);
  });
});

describe("p4 caption wiring", () => {
  const src = (p: string) => readFileSync(p, "utf8");
  const burner = src("components/create/CaptionBurner.tsx");
  const run = src("components/create/captions/CaptionRun.tsx");
  const rail = src("components/create/JourneyRail.tsx");
  const shift = src("components/create/captions/CaptionShift.tsx");
  test("the editor no longer owns the run: no abort on unmount, no AbortController of its own", () => {
    expect(burner).not.toContain("new AbortController");
    expect(burner).not.toContain("abort.current");
    expect(burner).toContain("useCaptionStore()");
    expect(burner).toContain("store.attach({ key, src, file, filename, duration, initialTrack })");
  });
  test("preview, jump, .srt and the clip cutter use the shifted lines", () => {
    expect(burner).toContain("cueAt(played, v.currentTime)");
    expect(burner).toContain("toSrt(exportCues(cues, offset, duration))");
    expect(burner).toContain("cues={cutCues}");
    expect(burner).toContain("<CaptionShift value={offset} onChange={store.setOffset}");
  });
  test("the workspace store stops on /create close and warns before the tab closes mid-run", () => {
    expect(run).toContain("useEffect(() => () => store.dispose(), [store]);");
    expect(run).toContain('window.addEventListener("beforeunload", warn);');
  });
  test("the rail shows the pill on Your story, with the reload limit said", () => {
    expect(rail).toContain('{s.id === "story" && <CaptionRunPill />}');
    expect(run).toContain("title={PILL_TIP}");
  });
  test("the shift control: 44px targets, arrows via a range input, tabular value, Reset", () => {
    expect(shift).toContain('type="range"');
    expect(shift).toContain("step={OFFSET_STEP}");
    expect(shift).toContain("tabular-nums");
    expect(shift.match(/h-11 w-11|min-h-11/g)!.length).toBeGreaterThanOrEqual(2);
    expect(shift).toContain("Reset");
  });
  test("no em or en dashes in the files this round touched", () => {
    for (const f of [burner, run, rail, shift, src("components/create/captions/run-store.ts"), src("lib/captions/offset.ts")]) expect(f).not.toMatch(/[\u2013\u2014]/);
  });
});
