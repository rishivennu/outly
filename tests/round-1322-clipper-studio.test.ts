/**
 * R1322: Shorts Clipper, the browser executor and the /clipper studio. The pure executor core (what the tab may take
 * on, which screen a job is on, the words, file names, range clamping, cue re-timing), the render maths the executor
 * shares with the server (drawFor), and the wiring: the page, the nav entry and the sign-in wall, the executor's
 * calls matching the routes, and the honesty lines on the screen.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BROWSER_MAX_SEC, browserProblem, clampRange, clipFileName, cuesWithin, mmss, screenOf, stalledWords, workingWords } from "../lib/clipper/executor-core";
import { drawFor } from "../lib/clipper/reframe-core";
import { CLIP_MAX_SEC, CLIP_MIN_SEC, STALL_MS } from "../lib/clipper/settings-core";
import { MAIN, pageTitle } from "../components/shell/nav-items";
import { STUDIO_PATHS } from "../lib/hosts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("R1322 executor-core", () => {
  test("browserProblem: the tab's own limit, said as a limit of this version", () => {
    expect(browserProblem({ duration: 600, mimeType: "video/mp4" })).toBeNull();
    expect(browserProblem({ duration: BROWSER_MAX_SEC + 1, mimeType: "video/mp4" })).toContain("up to 40 minutes");
    expect(browserProblem({ duration: BROWSER_MAX_SEC + 1, mimeType: "video/mp4" })).toContain("background worker");
    expect(browserProblem({ duration: 5, mimeType: "video/mp4" })).toContain("already a short");
    expect(browserProblem({ mimeType: "audio/mp3" })).toContain("needs a video");
    expect(browserProblem({ duration: null, mimeType: "video/quicktime" })).toBeNull();
  });

  test("screenOf follows the job, and a running job that stopped reporting is stalled", () => {
    const now = Date.now();
    const j = (status: string, stage: string, beatAgoMs = 0) => ({ status, stage, heartbeatAt: new Date(now - beatAgoMs).toISOString(), updatedAt: new Date(now - beatAgoMs).toISOString() });
    expect(screenOf(null)).toBe("upload");
    expect(screenOf(j("queued", "transcribe"), now)).toBe("processing");
    expect(screenOf(j("running", "transcribe"), now)).toBe("processing");
    expect(screenOf(j("running", "detect", STALL_MS + 1000), now)).toBe("stalled");
    expect(screenOf(j("ready", "review"), now)).toBe("review");
    expect(screenOf(j("ready", "done"), now)).toBe("done");
    expect(screenOf(j("failed", "detect"), now)).toBe("failed");
    expect(screenOf(j("cancelled", "detect"), now)).toBe("cancelled");
  });

  test("the words name the step and the part; the stalled line says what happens on resume", () => {
    expect(workingWords("transcribe", 0)).toBe("Reading the soundtrack");
    expect(workingWords("transcribe", 0.3, { done: 2, total: 9 })).toBe("Listening: part 3 of 9");
    expect(workingWords("transcribe", 0.99, { done: 9, total: 9 })).toBe("Listening: part 9 of 9");
    expect(workingWords("detect", 0)).toBe("Finding the moments worth a clip");
    const now = Date.now();
    expect(stalledWords({ heartbeatAt: new Date(now - 7 * 60_000).toISOString(), updatedAt: new Date(now).toISOString() }, now)).toContain("7 minutes ago");
    expect(stalledWords({ heartbeatAt: null, updatedAt: new Date(now - 60_000).toISOString() }, now)).toContain("1 minute ago");
    expect(stalledWords({ heartbeatAt: null, updatedAt: new Date(now).toISOString() }, now)).toContain("starts the current step again");
  });

  test("clampRange keeps a clip inside the source and the 8..90 s limits", () => {
    expect(clampRange({ start: 10, end: 40 }, 120)).toEqual({ start: 10, end: 40 });
    expect(clampRange({ start: 10, end: 12 }, 120)).toEqual({ start: 10, end: 10 + CLIP_MIN_SEC });
    expect(clampRange({ start: 115, end: 118 }, 120)).toEqual({ start: 112, end: 120 });
    expect(clampRange({ start: 0, end: 500 }, 600)).toEqual({ start: 0, end: CLIP_MAX_SEC });
    expect(clampRange({ start: -5, end: 30 }, 120)).toEqual({ start: 0, end: 30 });
    expect(mmss(65)).toBe("1:05");
    expect(mmss(0)).toBe("0:00");
  });

  test("cuesWithin re-times the lines from the clip's start and trims the edges", () => {
    const cues = [
      { start: 0, end: 4, text: "a" },
      { start: 4, end: 8, text: "b" },
      { start: 8, end: 12, text: "c" },
      { start: 12, end: 16, text: "d" },
    ];
    const got = cuesWithin(cues, { start: 5, end: 13 });
    expect(got.map((c) => c.text)).toEqual(["b", "c", "d"]);
    expect(got[0]).toEqual({ start: 0, end: 3, text: "b" });
    expect(got[2]).toEqual({ start: 7, end: 8, text: "d" });
  });

  test("clipFileName is safe and tells the clip apart", () => {
    expect(clipFileName("My Talk (final).mp4", { title: "Why nobody tells you this!", start: 40.4, end: 70 })).toBe("My Talk final-why-nobody-tells-you-this-40s.mp4");
    expect(clipFileName("", { title: "", start: 0, end: 10 })).toBe("video-clip-0s.mp4");
  });

  test("the render draws through the same rectangles the server reasons about", () => {
    // A 4K landscape source: full height, a 9:16 window, destination the whole 1080x1920 canvas.
    const d = drawFor(3840, 2160, { mode: "crop", x: 0.25, y: 0.5 });
    expect(d.sh).toBe(2160);
    expect(d.sw).toBe(1215);
    expect(d.sx).toBe(Math.round((3840 - 1215) * 0.25));
    expect([d.dx, d.dy, d.dw, d.dh]).toEqual([0, 0, 1080, 1920]);
  });
});

describe("R1322 wiring", () => {
  test("the studio page, the nav entry and the sign-in wall all know /clipper", () => {
    expect(read("app/(studio)/clipper/page.tsx")).toContain("ClipperStudio");
    const hrefs = MAIN.map((m) => m.href);
    expect(hrefs.indexOf("/clipper")).toBe(hrefs.indexOf("/create") + 1);
    expect(pageTitle("/clipper")).toBe("Clipper");
    expect(STUDIO_PATHS).toContain("/clipper");
    expect(read("middleware.ts")).toContain('"/clipper"');
  });

  test("the executor calls the routes that exist, with the payloads the routes take", () => {
    const ex = read("lib/client/clipper.ts");
    expect(ex).toContain('event: "start", executor: "browser"');
    expect(ex).toContain('event: "heartbeat", progress: Math.min(0.99'); // a fraction, as the route requires
    expect(ex).toContain('event: "transcribed", words: clean');
    expect(ex).toContain("/detect");
    expect(ex).toContain('status: "rendering", executor: "browser"');
    expect(ex).toContain('status: "rendered", mediaId: up.media.id');
    expect(ex).toContain('status: "failed", error:');
    expect(ex).toContain("canvas.width = OUT_W");
    expect(ex).toContain("drawFor(w, h, clip.reframe)");
    // Transcription rides the Caption Studio's metered endpoint, keyed by the source media.
    expect(ex).toContain("postChunk(all[i] as AudioChunk, { ref: job.mediaId ?? job.id");
    expect(ex).not.toContain("speaker");
  });

  test("the screens say what this version does and does not do", () => {
    const studio = read("components/clipper/ClipperStudio.tsx");
    expect(studio).toContain("videos up to 40 minutes for now");
    expect(studio).toContain("Speaker tracking is not part of this version");
    expect(studio).toContain("nothing is posted until you say so");
    const review = read("components/clipper/ReviewScreen.tsx");
    expect(review).toContain("{c.reason}"); // every moment shows its reason
    expect(review).toContain("score {c.score.toFixed(2)}");
    const editor = read("components/clipper/ClipEditor.tsx");
    expect(editor).toContain("will need a new export");
    expect(editor).toContain("The words were drafted from what is said in the clip");
    expect(editor).toContain("keptShare(");
  });
});
