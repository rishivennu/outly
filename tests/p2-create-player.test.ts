import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { audible, canSetVolume, clampVolume, createPlayback, needsFirstFrame, readPrefs, setVolume, toggleMute, writePrefs } from "../components/create/player-state";

const fake = (paused = true) => {
  const el = { paused, pauses: 0, pause() { this.paused = true; this.pauses++; }, play() { this.paused = false; } };
  return el;
};

describe("p2 player volume", () => {
  test("prefs round-trip and reject junk", () => {
    expect(readPrefs(writePrefs({ volume: 0.4, muted: true }))).toEqual({ volume: 0.4, muted: true });
    expect(readPrefs("{bad")).toEqual({ volume: 1, muted: false });
    expect(readPrefs(null)).toEqual({ volume: 1, muted: false });
    expect(readPrefs('{"volume":7}')).toEqual({ volume: 1, muted: false });
    expect(clampVolume(-2)).toBe(0);
    expect(clampVolume(NaN)).toBe(1);
  });
  test("slider at 0 mutes; unmute from 0 is audible", () => {
    expect(setVolume(0)).toEqual({ volume: 0, muted: true });
    expect(setVolume(0.3)).toEqual({ volume: 0.3, muted: false });
    expect(toggleMute({ volume: 0, muted: true })).toEqual({ volume: 0.5, muted: false });
    expect(toggleMute({ volume: 0.7, muted: false })).toEqual({ volume: 0.7, muted: true });
    expect(audible(toggleMute(toggleMute({ volume: 0.7, muted: false })))).toBe(true);
  });
  test("iOS style read-only volume is detected", () => {
    const writable = { volume: 1 };
    expect(canSetVolume(writable)).toBe(true);
    expect(writable.volume).toBe(1);
    const ios = { get volume() { return 1; }, set volume(_v: number) {} };
    expect(canSetVolume(ios)).toBe(false);
  });
  test("first frame is requested only without a poster, idle at 0", () => {
    expect(needsFirstFrame({ currentTime: 0, paused: true }, false)).toBe(true);
    expect(needsFirstFrame({ currentTime: 0, paused: true }, true)).toBe(false);
    expect(needsFirstFrame({ currentTime: 3, paused: true }, false)).toBe(false);
    expect(needsFirstFrame({ currentTime: 0, paused: false }, false)).toBe(false);
  });
});

describe("p2 one player at a time", () => {
  test("a main player pauses every other video", () => {
    const pb = createPlayback();
    const a = fake(), b = fake(false), loop = fake(false);
    pb.register(a, "main");
    pb.register(b, "main");
    pb.register(loop, "ambient");
    a.play();
    expect(pb.played(a)).toBe(true);
    expect(b.paused && loop.paused).toBe(true);
    expect(pb.mainPlaying()).toBe(true);
  });
  test("an ambient loop is refused while a main plays, allowed after", () => {
    const pb = createPlayback();
    const main = fake(), loop = fake();
    pb.register(main, "main");
    pb.register(loop, "ambient");
    let calls = 0;
    pb.subscribe(() => calls++);
    main.play();
    pb.played(main);
    loop.play();
    expect(pb.played(loop)).toBe(false);
    expect(loop.paused).toBe(true);
    main.pause();
    pb.stopped(main);
    expect(pb.mainPlaying()).toBe(false);
    loop.play();
    expect(pb.played(loop)).toBe(true);
    expect(calls).toBe(2);
  });
  test("unmounting clears the registry", () => {
    const pb = createPlayback();
    const main = fake();
    const off = pb.register(main, "main");
    main.play();
    pb.played(main);
    off();
    expect(pb.size()).toBe(0);
    expect(pb.mainPlaying()).toBe(false);
  });
});

describe("p2 player wiring", () => {
  const stage = readFileSync(new URL("../components/create/VideoStage.tsx", import.meta.url), "utf8");
  const prev = readFileSync(new URL("../components/create/Previews.tsx", import.meta.url), "utf8");
  test("stage registers as the main player, has a volume slider where possible and mute everywhere", () => {
    expect(stage).toContain('usePlayback(video, "main", src);');
    expect(stage).toContain('aria-label="Volume"');
    expect(stage).toContain("setVolCtl(canSetVolume(v));");
    expect(stage).toContain('aria-label={muted ? "Unmute" : "Mute"}');
    expect(stage).toContain("if (needsFirstFrame(v, !!poster)) v.currentTime = FIRST_FRAME;");
    expect(stage).toContain("setNatural(v.videoWidth / v.videoHeight)");
  });
  test("previews are ambient, keep the video's shape and show no invented counts", () => {
    expect(prev).toContain('usePlayback(ref, "ambient", src);');
    expect(prev).not.toContain("autoPlay");
    expect(prev).toContain("object-contain");
    for (const n of ["12.4K", "8.9K", "1.6K", "41K", "318", "1.1K"]) expect(prev).not.toContain(n);
  });
});
