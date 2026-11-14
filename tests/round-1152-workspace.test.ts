import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const burner = src("components/create/CaptionBurner.tsx");
const stage = src("components/create/VideoStage.tsx");
const ws = src("components/create/CreateWorkspace.tsx");
const publish = src("components/create/PublishTo.tsx");
const rail = src("components/create/JourneyRail.tsx");

describe("1152 one video player", () => {
  test("the caption editor keeps no second preview of its own", () => {
    expect(burner).not.toContain("<video");
    expect(burner).not.toContain("useRef<HTMLVideoElement>");
    expect(burner).toContain("video: React.RefObject<HTMLVideoElement | null>;");
    expect(burner).toContain("canvas: React.RefObject<HTMLCanvasElement | null>;");
  });
  test("the workspace hands the same player and overlay to both", () => {
    expect(ws).toContain("videoRef={capVideo}");
    expect(ws).toContain("video={capVideo}");
    expect(ws).toContain("canvas={capCanvas}");
    expect(ws).toContain('overlay={<canvas ref={capCanvas} className="pointer-events-none absolute inset-0 h-full w-full object-cover" aria-hidden="true" />}');
    // the live overlay draws on the clean video, never on a burned copy
    expect(ws).toContain("src={capLive && preCaption ? preCaption.media.url : src}");
  });
  test("the player never passes off a black box as a loaded video", () => {
    expect(stage).toContain('type Load = "loading" | "ready" | "error";');
    expect(stage).toContain("Loading your preview");
    expect(stage).toContain("This preview didn&apos;t load.");
    expect(stage).toContain('onError={() => setLoad("error")}');
    expect(stage).toContain("const video = videoRef ?? own;");
  });
  test("one compact toolbar lists the file facts and Replace", () => {
    for (const k of ["Length", "Resolution", "Aspect ratio", "File size", "Format"]) expect(stage).toContain(`k: "${k}"`);
    expect(stage).toContain('aria-label="Video details"');
    expect(stage).toContain('aria-label="Replace video"');
  });
});

describe("1152 caption editor", () => {
  test("rows can be reordered, deleted and added at the playhead", () => {
    expect(burner).toContain("aria-label={`Move caption ${i + 1} up`}");
    expect(burner).toContain("aria-label={`Move caption ${i + 1} down`}");
    expect(burner).toContain("aria-label={`Delete caption ${i + 1}`}");
    expect(burner).toContain("onClick={add}");
    expect(burner).toContain('<p className="sr-only" aria-live="polite">{moved}</p>');
  });
  test("the line on screen is marked, with more than colour", () => {
    expect(burner).toContain('aria-current={live ? "true" : undefined}');
    expect(burner).toContain("ring-1 ring-lime/60");
  });
  test("each row shows its start and end", () => {
    expect(burner).toContain("{fmt(c.start)}</span>");
    expect(burner).toContain("to {fmt(c.end)}</span>");
  });
  test("positions read top to bottom", () => {
    const i = (s: string) => burner.indexOf(`label: "${s}"`);
    expect(i("Top")).toBeLessThan(i("Middle"));
    expect(i("Middle")).toBeLessThan(i("Bottom"));
  });
  test("Burn and .srt are different kinds of button", () => {
    expect(burner).toMatch(/variant="primary" onClick=\{burn\}/);
    expect(burner).toMatch(/variant="outline" onClick=\{downloadSrt\}/);
    expect(burner).toContain("Use the video without captions");
  });
});

describe("1152 layout and assistant", () => {
  test("Step 2 is preview + editor side by side", () => {
    expect(ws).toContain("const stage = showVideo && hasMedia;");
    expect(ws).toContain("md:grid md:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]");
    expect(rail).toContain('roomy ? "min-[1800px]:flex" : "xl:flex"');
  });
  test("below 1280px the one assistant opens as a modal drawer", () => {
    expect(ws).toContain('role={sheet ? "dialog" : undefined}');
    expect(ws).toContain("aria-modal={sheet || undefined}");
    expect(ws).toContain('aria-label="Close Pip"');
    expect(ws).toContain('if (e.key === "Escape")');
    expect(ws.match(/\{assistant\}/g)?.length).toBe(1);
  });
  test("publishing shows how many places are picked", () => {
    expect(publish).toContain("{chosen.length} selected");
    expect(publish).toContain("aria-pressed={on}");
  });
});

describe("1152 fits at 1280", () => {
  test("xl gives the editor room: a slimmer preview column and a 300px Pip", () => {
    expect(ws).toContain("xl:grid-cols-[minmax(240px,272px)_minmax(0,1fr)]");
    expect(ws).toContain('"xl:w-[300px] xl:opacity-100 2xl:w-[340px]"');
    expect(burner).toContain("sm:grid-cols-2 xl:group-data-[pip=open]/edit:grid-cols-1 2xl:group-data-[pip=open]/edit:grid-cols-2");
    expect(ws).toContain('data-pip={pipShown ? "open" : "closed"} className="group/edit');
  });
  test("the column toolbar lays facts out in a grid without stray separators", () => {
    expect(stage).toContain('column ? "grid grid-cols-3');
    expect(stage).toContain("i > 0 && !column &&");
  });
  test("platform chips are wide enough for their names", () => {
    expect(publish).toContain("minmax(min(100%,168px),1fr)");
  });
});

import { insertCue } from "../lib/captions/insert";
import { cueAt } from "../lib/captions/cues";

const noOverlap = (cs: { start: number; end: number }[]) => cs.every((c, i) => i === 0 || cs[i - 1].end <= c.start + 1e-9);

describe("1152 add caption never overlaps", () => {
  test("touching cues: the new line goes in the next real gap, not on top of B", () => {
    const cues = [{ start: 0, end: 2, text: "A" }, { start: 2, end: 4, text: "B" }, { start: 6, end: 8, text: "C" }];
    const r = insertCue(cues, 1, 10)!;
    expect(r.cues[r.index]).toEqual({ start: 4, end: 6, text: "New caption" });
    expect(r.cues.map((c) => c.text)).toEqual(["A", "B", "New caption", "C"]);
    expect(noOverlap(r.cues)).toBe(true);
    expect(cueAt(r.cues, 5)?.text).toBe("New caption");
  });
  test("a free playhead starts the line right there", () => {
    const r = insertCue([{ start: 0, end: 1, text: "A" }], 3, 10)!;
    expect(r.cues[r.index]).toMatchObject({ start: 3, end: 5 });
  });
  test("a tiny gap is skipped", () => {
    const cues = [{ start: 0, end: 2, text: "A" }, { start: 2.1, end: 4, text: "B" }];
    const r = insertCue(cues, 1, 5)!;
    expect(r.cues[r.index]).toMatchObject({ start: 4, end: 5 });
    expect(noOverlap(r.cues)).toBe(true);
  });
  test("no gap after the playhead: wraps to an earlier gap", () => {
    const cues = [{ start: 1, end: 5, text: "A" }];
    const r = insertCue(cues, 3, 5)!;
    expect(r.cues[r.index]).toMatchObject({ start: 0, end: 1 });
    expect(r.index).toBe(0);
  });
  test("no gap anywhere: the line on screen is split", () => {
    const cues = [{ start: 0, end: 2, text: "A" }, { start: 2, end: 4, text: "B" }];
    const r = insertCue(cues, 3, 4)!;
    expect(r.cues).toEqual([{ start: 0, end: 2, text: "A" }, { start: 2, end: 3, text: "B" }, { start: 3, end: 4, text: "New caption" }]);
    expect(noOverlap(r.cues)).toBe(true);
  });
  test("no room at all returns null", () => {
    expect(insertCue([{ start: 0, end: 0.4, text: "A" }], 0, 0.4)).toBeNull();
  });
  test("unknown duration still adds after the last line", () => {
    const r = insertCue([{ start: 0, end: 2, text: "A" }], 1, 0)!;
    expect(r.cues[r.index]).toMatchObject({ start: 2, end: 4 });
  });
  test("the burner uses it and clears a stale line while a source loads", () => {
    expect(burner).toContain("insertCue(cues, video.current?.currentTime ?? 0, duration)");
    expect(burner).toContain("// A new source is loading");
    expect(ws).toContain("h-full w-full object-cover");
  });
});
