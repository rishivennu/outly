/**
 * Round 1265: a reload no longer kills a caption run without a word (sessionStorage marker, "Start again"), and a
 * burn that finished off Step 2 is offered on Launch too, with the same two choices and the same store calls.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createCaptionStore, runPill, type Deps } from "../components/create/captions/run-store";
import { clearMarker, interruptedLine, readMarker, restartAction, RUN_MARKER_KEY, RUN_MARKER_TTL, stageLabel, writeMarker, type MarkerStorage } from "../components/create/captions/run-resume";
import { PENDING_BURN_LINE, PendingBurnBody, PendingBurnNotice, pendingBurnActions } from "../components/create/captions/PendingBurnNotice";
import type { Cue } from "../lib/captions/cues";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const cues: Cue[] = [{ start: 0, end: 1, text: "hi" }];
const track = { v: 1, cues, style: "pop", pos: "bottom" };
const tick = () => new Promise((r) => setTimeout(r, 0));

function memory(): MarkerStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

function rig(storage: MarkerStorage, extra: Partial<Deps> = {}) {
  let release: (() => void) | null = null;
  const gate = new Promise<void>((r) => (release = r));
  const burns: Cue[][] = [];
  const deps: Partial<Deps> = {
    api: (async () => ({})) as Deps["api"],
    burnCaptions: (async (_src: string, cs: Cue[]) => {
      burns.push(cs);
      await gate;
      return new File(["v"], "clip-captions.mp4", { type: "video/mp4" });
    }) as unknown as Deps["burnCaptions"],
    offerUpgrade: () => {},
    storage: () => storage,
    ...extra,
  };
  return { store: createCaptionStore(deps), release: () => release!(), burns };
}

describe("run-resume: the reload marker", () => {
  test("write, read, clear", () => {
    const s = memory();
    writeMarker(s, "m1", "translate", 1000);
    expect(JSON.parse(s.data.get(RUN_MARKER_KEY)!)).toEqual({ key: "m1", stage: "translate", at: 1000 });
    expect(readMarker(s, 2000)).toEqual({ key: "m1", stage: "translate", at: 1000 });
    clearMarker(s);
    expect(readMarker(s, 2000)).toBeNull();
  });
  test("older than 30 minutes, malformed or missing storage: nothing", () => {
    const s = memory();
    expect(RUN_MARKER_TTL).toBe(30 * 60 * 1000);
    writeMarker(s, "m1", "burn", 0);
    expect(readMarker(s, RUN_MARKER_TTL)).not.toBeNull();
    expect(readMarker(s, RUN_MARKER_TTL + 1)).toBeNull();
    s.data.set(RUN_MARKER_KEY, "{not json");
    expect(readMarker(s)).toBeNull();
    s.data.set(RUN_MARKER_KEY, JSON.stringify({ key: "m1", stage: "dance", at: Date.now() }));
    expect(readMarker(s)).toBeNull();
    expect(readMarker(null)).toBeNull();
    expect(() => writeMarker(null, "m1", "burn")).not.toThrow();
    const broken: MarkerStorage = { getItem: () => { throw new Error("off"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("off"); } };
    expect(readMarker(broken)).toBeNull();
    expect(() => writeMarker(broken, "m1", "burn")).not.toThrow();
    expect(() => clearMarker(broken)).not.toThrow();
  });
  test("stage words, the line, and what Start again runs", () => {
    expect(stageLabel("transcribe")).toBe("generated");
    expect(stageLabel("translate")).toBe("translated");
    expect(stageLabel("burn")).toBe("burned in");
    expect(interruptedLine("burn")).toBe("Your captions were still being burned in when the page reloaded. Start again to pick up from the video.");
    expect(interruptedLine("transcribe")).not.toContain("\u2014");
    expect(restartAction("transcribe", true)).toBe("transcribe");
    expect(restartAction("translate", true)).toBe("translate");
    expect(restartAction("burn", true)).toBe("burn");
    expect(restartAction("translate", false)).toBe("transcribe");
    expect(restartAction("burn", false)).toBe("transcribe");
  });
});

describe("run store: interrupted by a reload", () => {
  test("a busy run keeps a marker for its video; finishing clears it", async () => {
    const s = memory();
    const { store, release } = rig(s);
    store.attach({ key: "m1", src: "blob:x", filename: "clip.mp4", duration: 5 });
    const p = store.burn(cues);
    await tick();
    expect(store.getState().busy?.kind).toBe("burn");
    expect(readMarker(s)).toMatchObject({ key: "m1", stage: "burn" });
    release();
    await p;
    expect(readMarker(s)).toBeNull();
  });
  test("Stop and /create closing clear it too", async () => {
    const s = memory();
    const a = rig(s);
    a.store.attach({ key: "m1", src: "blob:x", filename: "clip.mp4", duration: 5 });
    const p = a.store.burn(cues);
    await tick();
    a.store.stop();
    a.release();
    await p;
    expect(readMarker(s)).toBeNull();
    const b = rig(s);
    b.store.attach({ key: "m1", src: "blob:x", filename: "clip.mp4", duration: 5 });
    void b.store.burn(cues);
    await tick();
    expect(readMarker(s)).not.toBeNull();
    b.store.dispose();
    expect(readMarker(s)).toBeNull();
  });
  test("after a reload, the same video shows interrupted and the pill settles on Run interrupted", () => {
    const s = memory();
    writeMarker(s, "m1", "translate");
    const { store } = rig(s);
    store.attach({ key: "m1", src: "blob:x", filename: "clip.mp4", duration: 5, initialTrack: track });
    expect(store.getState().interrupted).toEqual({ stage: "translate" });
    expect(runPill(store.getState())).toBe("Run interrupted");
    store.dismissInterrupted();
    expect(store.getState().interrupted).toBeNull();
    expect(runPill(store.getState())).toBeNull();
    expect(readMarker(s)).toBeNull();
  });
  test("another video, or an expired marker: no notice, and the stale marker goes", () => {
    const s = memory();
    writeMarker(s, "m1", "burn");
    const a = rig(s).store;
    a.attach({ key: "m2", src: "blob:y", filename: "other.mp4", duration: 4 });
    expect(a.getState().interrupted).toBeNull();
    expect(readMarker(s)).toBeNull();
    writeMarker(s, "m1", "burn", Date.now() - RUN_MARKER_TTL - 1);
    const b = rig(s).store;
    b.attach({ key: "m1", src: "blob:x", filename: "clip.mp4", duration: 5 });
    expect(b.getState().interrupted).toBeNull();
  });
  test("Start again burns the kept lines from scratch", async () => {
    const s = memory();
    writeMarker(s, "m1", "burn");
    const { store, release, burns } = rig(s);
    store.attach({ key: "m1", src: "blob:x", filename: "clip.mp4", duration: 5, initialTrack: track });
    const got: string[] = [];
    store.setHandlers({ onBurned: (f) => got.push(f.name) });
    const p = store.restart("Poppins");
    await tick();
    expect(store.getState().interrupted).toBeNull();
    expect(store.getState().on).toBe(true);
    expect(store.getState().busy?.kind).toBe("burn");
    expect(burns.length).toBe(1);
    expect(burns[0][0].text).toBe("hi");
    release();
    await p;
    expect(got).toEqual(["clip-captions.mp4"]);
    expect(readMarker(s)).toBeNull();
  });
  test("Start again with no lines kept transcribes; a fresh store with nothing interrupted does nothing", async () => {
    const s = memory();
    writeMarker(s, "m1", "translate");
    let reads = 0;
    const { store } = rig(s, { audioChunks: (async () => { reads++; return []; }) as unknown as Deps["audioChunks"] });
    store.attach({ key: "m1", src: "blob:x", filename: "clip.mp4", duration: 5 });
    await store.restart();
    expect(reads).toBe(1);
    expect(store.getState().interrupted).toBeNull();
    await store.restart();
    expect(reads).toBe(1);
  });
  test("a new run clears the notice", async () => {
    const s = memory();
    writeMarker(s, "m1", "transcribe");
    const { store, release } = rig(s);
    store.attach({ key: "m1", src: "blob:x", filename: "clip.mp4", duration: 5, initialTrack: track });
    const p = store.burn(cues);
    await tick();
    expect(store.getState().interrupted).toBeNull();
    release();
    await p;
  });
  test("the editor and the pill are wired", () => {
    const burner = src("components/create/CaptionBurner.tsx");
    expect(burner).toContain("{interruptedLine(interrupted.stage)}");
    expect(burner).toContain("void store.restart(captionFontFamily);");
    expect(burner).toContain("onClick={() => store.dismissInterrupted()}");
    expect(burner).toContain(">Start again</Button>");
    const run = src("components/create/captions/CaptionRun.tsx");
    expect(run).toContain('text !== "Needs a look" && text !== INTERRUPTED_PILL');
    // The beforeunload guard watches any busy kind, so transcribe, translate and burn all ask first.
    expect(run).toContain("const busy = useSyncExternalStore(store.subscribe, () => !!store.getState().busy, () => false);");
    expect(run).toContain('window.addEventListener("beforeunload", warn);');
  });
});

function buttons(node: ReactNode, out: ReactElement<{ onClick?: () => void; children?: ReactNode }>[] = []) {
  if (Array.isArray(node)) for (const n of node) buttons(n, out);
  else if (isValidElement<{ onClick?: () => void; children?: ReactNode }>(node)) {
    if (node.props.onClick) out.push(node);
    buttons(node.props.children, out);
  }
  return out;
}
const text = (n: ReactNode): string => (Array.isArray(n) ? n.map(text).join("") : typeof n === "string" ? n : isValidElement<{ children?: ReactNode }>(n) ? text(n.props.children) : "");

describe("PendingBurnNotice: the same choice on Launch", () => {
  async function pending() {
    const { store, release } = rig(memory());
    store.attach({ key: "m1", src: "blob:x", filename: "clip.mp4", duration: 5 });
    const p = store.burn(cues);
    release();
    await p;
    return store;
  }
  test("renders both buttons in a polite live region only while a burn waits", async () => {
    const store = await pending();
    const html = renderToStaticMarkup(createElement(PendingBurnNotice, { store }));
    expect(html).toContain(PENDING_BURN_LINE);
    expect(html).toContain("Use captioned video");
    expect(html).toContain("Keep this video");
    expect(html).toContain('aria-live="polite"');
    store.dropBurn();
    expect(renderToStaticMarkup(createElement(PendingBurnNotice, { store }))).toBe("");
  });
  test("Use captioned video runs the workspace swap with no editor mounted; Keep this video drops it", async () => {
    const store = await pending();
    const got: string[] = [];
    expect(store.takeBurn()).toBe(false);
    expect(pendingBurnActions(store, (f, kind) => got.push(`${f.name}:${kind}`)).use()).toBe(true);
    expect(got).toEqual(["clip-captions.mp4:captions"]);
    expect(store.getState().pendingBurn).toBeNull();
    expect(store.getState().burned).toBe(true);
    const other = await pending();
    pendingBurnActions(other).keep();
    expect(other.getState().pendingBurn).toBeNull();
    expect(other.getState().burned).toBe(false);
  });
  test("the body's buttons call what they are given", () => {
    const calls: string[] = [];
    const el = PendingBurnBody({ onUse: () => calls.push("use"), onKeep: () => calls.push("keep") });
    const bs = buttons(el);
    expect(bs.map((b) => text(b.props.children))).toEqual(["Use captioned video", "Keep this video"]);
    for (const b of bs) b.props.onClick!();
    expect(calls).toEqual(["use", "keep"]);
  });
  test("CreateWorkspace mounts it on the launch step only, with the shared swap", () => {
    const ws = src("components/create/CreateWorkspace.tsx");
    const mounts = ws.split("<PendingBurnNotice ").length - 1;
    expect(mounts).toBe(1);
    const at = ws.indexOf("<PendingBurnNotice store={capStore} onBurned={onCapBurned}");
    const launch = ws.indexOf('{step === "launch" && (');
    const panel = ws.indexOf("<LaunchPanel ", launch);
    expect(launch).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(launch);
    expect(at).toBeLessThan(panel);
    expect(ws).toContain("onBurned={onCapBurned}");
    expect(ws).toContain("const onCapBurned = (f: File, kind?: \"captions\" | \"cut\") => {");
  });
});
