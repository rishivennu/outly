/**
 * Phase 4 review fixes: a burn that lands while the caption editor is not showing waits as pendingBurn
 * (the video never changes under Everywhere or Launch), and Publish/Schedule wait while a burn runs.
 * Transport is stubbed through the store's deps; the product path uses the real ones.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createCaptionStore, runPill, type Deps } from "../components/create/captions/run-store";
import { barState, BURN_SEND, type BarInput } from "../components/create/ActionBar";
import type { Cue } from "../lib/captions/cues";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const cues: Cue[] = [{ start: 0, end: 1, text: "hi" }];

function rig() {
  let release: (() => void) | null = null;
  const gate = new Promise<void>((r) => (release = r));
  const deps: Partial<Deps> = {
    api: (async () => ({})) as Deps["api"],
    burnCaptions: (async () => {
      await gate;
      return new File(["v"], "clip-captions.mp4", { type: "video/mp4" });
    }) as Deps["burnCaptions"],
    offerUpgrade: () => {},
  };
  const store = createCaptionStore(deps);
  store.attach({ key: "m1", src: "blob:x", filename: "clip.mp4", duration: 5 });
  return { store, release: () => release!() };
}

describe("p4 fix: a burn that lands off step", () => {
  test("editor mounted: the burn goes straight to it", async () => {
    const { store, release } = rig();
    const got: string[] = [];
    store.setHandlers({ onBurned: (f) => got.push(f.name) });
    const p = store.burn(cues);
    release();
    await p;
    expect(got).toEqual(["clip-captions.mp4"]);
    expect(store.getState().pendingBurn).toBeNull();
    expect(store.getState().burned).toBe(true);
  });

  test("editor gone: the file waits, the pill says Captions ready, nothing swaps", async () => {
    const { store, release } = rig();
    const got: string[] = [];
    const tracks: unknown[] = [];
    store.setHandlers({ onBurned: (f) => got.push(f.name), onTrackChange: (t) => tracks.push(t) });
    const p = store.burn(cues);
    await new Promise((r) => setTimeout(r, 0));
    expect(store.getState().busy?.kind).toBe("burn");
    store.detach();
    release();
    await p;
    expect(got).toEqual([]);
    expect(store.getState().pendingBurn?.name).toBe("clip-captions.mp4");
    expect(store.getState().burned).toBe(false);
    expect(runPill(store.getState())).toBe("Captions ready");
    store.ack();
    expect(runPill(store.getState())).toBe("Captions ready");
    store.set({ on: true });
    expect(tracks.length).toBeGreaterThan(0);
  });

  test("Use captioned video hands it to the editor now showing, once", async () => {
    const { store, release } = rig();
    store.setHandlers({});
    const p = store.burn(cues);
    release();
    await p;
    expect(store.takeBurn()).toBe(false);
    const got: string[] = [];
    store.setHandlers({ onBurned: (f, kind) => got.push(`${f.name}:${kind}`) });
    expect(store.takeBurn()).toBe(true);
    expect(got).toEqual(["clip-captions.mp4:captions"]);
    expect(store.getState().pendingBurn).toBeNull();
    expect(store.getState().burned).toBe(true);
    expect(store.takeBurn()).toBe(false);
    expect(runPill(store.getState())).toBeNull();
  });

  test("Keep this video drops it; a new video drops it too", async () => {
    const { store, release } = rig();
    const p = store.burn(cues);
    release();
    await p;
    store.dropBurn();
    expect(store.getState().pendingBurn).toBeNull();
    const b = rig();
    const q = b.store.burn(cues);
    b.release();
    await q;
    expect(b.store.getState().pendingBurn).not.toBeNull();
    b.store.attach({ key: "m2", src: "blob:y", filename: "other.mp4", duration: 4 });
    expect(b.store.getState().pendingBurn).toBeNull();
  });

  test("the editor wiring: detach on unmount, the offer, the pill settles", () => {
    const burner = src("components/create/CaptionBurner.tsx");
    expect(burner).toContain("useEffect(() => () => store.detach(), [store]);");
    expect(burner).toContain("onClick={() => store.takeBurn()}");
    expect(burner).toContain("Use captioned video");
    expect(burner).toContain("onClick={() => store.dropBurn()}");
    const run = src("components/create/captions/CaptionRun.tsx");
    expect(run).toContain('const settled = text === "Done" || text === "Captions ready";');
  });
});

describe("p4 fix: Publish and Schedule wait for a burn", () => {
  const base: BarInput = { online: true, hasMedia: true, uploadFailed: false, hasCaption: true, ready: true, enabledCount: 1, launching: false, saving: false, targets: ["youtube"] };
  test("Launch: the publish button is off with the reason while burning", () => {
    const s = barState({ ...base, step: "launch", burning: true });
    expect(s.publish.disabled).toBe(true);
    expect(s.publish.hint).toBe(BURN_SEND);
    expect(s.note).toBe(BURN_SEND);
    expect(s.schedule.disabled).toBe(true);
    expect(barState({ ...base, step: "launch", burning: false }).publish.disabled).toBe(false);
  });
  test("offline and not-ready reasons still come first; moving between steps is not blocked", () => {
    expect(barState({ ...base, step: "launch", burning: true, online: false }).publish.hint).not.toBe(BURN_SEND);
    expect(barState({ ...base, step: "launch", burning: true, ready: false }).publish.hint).not.toBe(BURN_SEND);
    const ev = barState({ ...base, step: "everywhere", burning: true });
    expect(ev.buttons.find((b) => b.id === "continue")?.disabled).toBe(false);
  });
  test("the workspace passes the burn and the launch itself refuses mid-burn", () => {
    const ws = src("components/create/CreateWorkspace.tsx");
    expect(ws).toContain("burning: capBurning");
    expect(ws).toContain('if (capStore.getState().busy?.kind === "burn") return setLaunchError(BURN_SEND);');
  });
});

describe("p4 fix: Pip on Launch when folded", () => {
  test("the launch line sits outside the folded history, so the latest message always shows", () => {
    const a = src("components/create/Assistant.tsx");
    // R1209 A3: nothing folds any more; the launch line always shows, above the end marker.
    const launch = a.indexOf('{p.step === "launch" &&');
    const end = a.indexOf("<div ref={end} />");
    expect(launch).toBeGreaterThan(-1);
    expect(a).not.toContain("showHistory");
    expect(launch).toBeLessThan(end);
    expect(a).toContain("const l = launchLine(");
  });
});
