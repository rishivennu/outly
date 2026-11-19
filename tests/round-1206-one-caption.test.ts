/**
 * R1206 Content Studio: one caption, written in exactly one place. Step 2 is video, subtitles, the caption,
 * Generate, then the platform results; Step 3 only shows the original and takes you back to change it. Pip is a
 * companion that suggests, never a second writing box, and it never opens itself over the creator's fold.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { subtitleStatus, type SubtitleFacts } from "../components/create/VideoSubtitles";
import { CAPTION_PLACEHOLDER } from "../components/create/StoryComposer";
import { DECK_ASKS, PIP_ASKS, PIP_ASK_RULE, ASK_KEYS, STORY_ASKS } from "../lib/ai/pip-asks";

const src = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const ws = src("components/create/CreateWorkspace.tsx");
const deck = src("components/create/PlatformDeck.tsx");
const pip = src("components/create/Assistant.tsx");
const subs = src("components/create/VideoSubtitles.tsx");
const story = src("components/create/StoryComposer.tsx");

describe("R1206 Step 2 in the brief's order", () => {
  test("subtitles sit directly above the one caption editor, in the same column", () => {
    const col = ws.slice(ws.indexOf('<div data-pip={pipShown ? "open" : "closed"}'));
    const iSubs = col.indexOf("<VideoSubtitles");
    const iStory = col.indexOf("<StoryComposer");
    expect(iSubs).toBeGreaterThan(-1);
    expect(iStory).toBeGreaterThan(-1);
    expect(iSubs).toBeLessThan(iStory);
  });
  test("the caption placeholder is the brief's, and the editor is the only one", () => {
    expect(CAPTION_PLACEHOLDER).toBe("Write your caption or describe what you want your audience to know...");
    expect(story).toContain('<label htmlFor="story-box">Your caption</label>');
  });
});

describe("R1206 the subtitle section says which of the six states it is in", () => {
  const f: SubtitleFacts = { lines: 0, busy: null, failed: false, gaps: 0, english: false };
  test("not generated, transcribing, ready, translation available, needs review, failed", () => {
    expect(subtitleStatus(f)).toEqual({ label: "Not generated yet", tone: "idle" });
    expect(subtitleStatus({ ...f, busy: "transcribe" })).toEqual({ label: "Transcribing", tone: "busy" });
    expect(subtitleStatus({ ...f, lines: 38 })).toEqual({ label: "38 subtitles ready", tone: "ok" });
    expect(subtitleStatus({ ...f, lines: 38, english: true }).label).toBe("38 subtitles ready · translation available");
    expect(subtitleStatus({ ...f, lines: 38, gaps: 2 })).toEqual({ label: "Needs review", tone: "warn" });
    expect(subtitleStatus({ ...f, lines: 38, failed: true })).toEqual({ label: "Failed — retry", tone: "warn" });
  });
  test("a run in progress wins over a count, so nothing claims to be ready while it is being written", () => {
    expect(subtitleStatus({ ...f, lines: 38, busy: "translate", gaps: 2, failed: true }).label).toBe("Translating");
    expect(subtitleStatus({ ...f, busy: "burn" }).label).toBe("Adding them to the video");
  });
  test("subtitles are the spoken words, never a social caption", () => {
    expect(subs).toContain("Transcribe speech and create synchronized subtitles for your video.");
    expect(subs).toContain("never feed or replace one");
  });
});

describe("R1206 the caption is written in exactly one place", () => {
  test("Step 3 has no writer: no source editor, no save, no shared main caption", () => {
    for (const s of ["Edit source caption", "Save source caption", "Main caption", "Use main caption", "Update platform captions too?"]) expect(deck).not.toContain(s);
    expect(deck).not.toContain("onStory");
    expect(deck).not.toContain("mainCaption(");
  });
  test("Step 3 shows the original folded and read-only, and sends the creator back to change it", () => {
    for (const s of ["Original caption", "View original", "Change your caption", "Use original caption"]) expect(deck).toContain(s);
    expect(deck).toContain("onEditSource?: () => void;");
    expect(ws).toContain('onEditSource={() => goTo("story"');
  });
  test("Pip's own older hook flow and watch cards are off wherever the page has the editor", () => {
    expect(pip).toContain("{!p.composer && result?.understood && (");
    for (const k of ["watching", "ready", "failed"]) expect(pip).toContain(`{askStory && !p.composer && p.watch?.kind === "${k}" && (`);
    expect(pip).toContain("const ownBox = askStory && !p.composer;");
  });
  test("generating confirms once and moves the creator into the platform results", () => {
    const fn = ws.slice(ws.indexOf("const adapt = async"), ws.indexOf("const analyze = () =>"));
    expect(fn).toContain("Have a read.");
    expect(fn).toContain('document.getElementById("adapted-captions")?.scrollIntoView(');
    expect(fn).toContain("if (!o.direct) {");
  });
});

describe("R1206 Pip is a companion, not a second writer", () => {
  test("the brief's four Step 2 asks are there, each with a rule and the fields it may change", () => {
    for (const id of ["conversational", "professional", "voice", "hashtags"]) {
      expect(STORY_ASKS.some((a) => a.id === id)).toBe(true);
      expect((PIP_ASKS as readonly string[]).includes(id)).toBe(true);
    }
    for (const a of PIP_ASKS) {
      expect(PIP_ASK_RULE[a].length).toBeGreaterThan(20);
      expect(ASK_KEYS[a].length).toBeGreaterThan(0);
    }
  });
  test("each platform's own ask belongs to that platform alone", () => {
    const only = Object.fromEntries(DECK_ASKS.filter((a) => a.only).map((a) => [a.id, a.only]));
    expect(only).toEqual({ ytmeta: ["youtube"], lesson: ["linkedin"], concise: ["x"] });
    expect(ASK_KEYS.ytmeta).toEqual(["title", "description", "hashtags"]);
    expect(ASK_KEYS.concise).toEqual(["caption"]);
  });
  test("Pip never opens itself over a fold the creator made", () => {
    expect(ws).toContain('return window.localStorage.getItem(PIP_PANEL_KEY) === "closed";');
    expect(ws).toContain("if (pipFolded()) return;");
  });
});
