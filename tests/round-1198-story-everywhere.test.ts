// R1198: Step 2 "Your caption" + Step 3 "Everywhere" redesign. Pip's one-tap asks, separate subtitles, source caption.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ASK_KEYS, DECK_ASKS, isPipAsk, PIP_ASK_RULE, PIP_ASKS, STORY_ASKS } from "../lib/ai/pip-asks";
import { askProposal, pipOpensOn, pipTarget } from "../components/create/assistant-state";
import { emptyDraft, type PlatformCopy } from "../components/create/types";
import { platformCopyRequestSchema } from "../lib/validation";
import { subtitlesLine } from "../components/create/VideoSubtitles";
import { CAPTION_PLACEHOLDER } from "../components/create/StoryComposer";

const src = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const ws = src("components/create/CreateWorkspace.tsx");
const deck = src("components/create/PlatformDeck.tsx");
const story = src("components/create/StoryComposer.tsx");
const rows = src("components/create/AdaptedCaptions.tsx");
const subs = src("components/create/VideoSubtitles.tsx");
const acts = src("components/create/PipActions.tsx");
const route = src("app/api/ai/platform/route.ts");
const creative = src("lib/ai/creative.ts");

describe("R1198 Pip's asks", () => {
  test("Step 2 and Step 3 offer exactly the asks in the brief", () => {
    expect(STORY_ASKS.map((a) => a.label)).toEqual(["Improve my hook", "Make it shorter", "Make it engaging", "Improve the CTA", "Adapt for another platform"]);
    expect(DECK_ASKS.map((a) => a.label)).toEqual(["Improve this hook", "Make it shorter", "Improve the CTA", "Suggest relevant hashtags", "Adapt for the selected platform"]);
  });
  test("every ask has a rule for the model and the fields it may change; hashtags never touch the caption", () => {
    for (const a of PIP_ASKS) {
      expect(PIP_ASK_RULE[a].length).toBeGreaterThan(20);
      expect(ASK_KEYS[a].length).toBeGreaterThan(0);
    }
    expect(ASK_KEYS.hashtags).toEqual(["hashtags"]);
    expect(isPipAsk("shorter")).toBe(true);
    expect(isPipAsk("delete")).toBe(false);
  });
  test("an answer becomes a suggestion with only the allowed fields, and none when nothing changed", () => {
    const d = { ...emptyDraft(true), caption: "Old words", hashtags: "#old" };
    const c: PlatformCopy = { platform: "instagram", caption: "New words", hashtags: "#new", note: "Shorter hook." };
    expect(askProposal(d, c, ASK_KEYS.hashtags, "")).toEqual({ patch: { hashtags: "#new" }, why: "Shorter hook." });
    expect(askProposal(d, c, ASK_KEYS.cta, "Clearer ask")).toEqual({ patch: { caption: "New words" }, why: "Clearer ask" });
    expect(askProposal(d, { ...c, caption: "Old words", hashtags: "#old" }, ASK_KEYS.adapt, "")).toBeNull();
    expect(askProposal(d, { ...c, caption: "   " }, ASK_KEYS.cta, "")).toBeNull(); // blank is never proposed
  });
  test("the place Pip works on is the one last touched while it is still on, else the first", () => {
    expect(pipTarget("youtube", ["instagram", "youtube"])).toBe("youtube");
    expect(pipTarget("x", ["instagram", "youtube"])).toBe("instagram");
    expect(pipTarget(null, [])).toBeNull();
  });
  test("the API takes one ask with the words that place has now, and rejects anything else", () => {
    const base = { story: "I tried the 5am routine", hook: "5am for 30 days", platforms: ["instagram"] };
    expect(platformCopyRequestSchema.parse({ ...base, ask: "hook", current: { caption: "x" } }).current).toEqual({ title: "", caption: "x", description: "", hashtags: "" });
    expect(() => platformCopyRequestSchema.parse({ ...base, ask: "rewrite-everything" })).toThrow();
  });
  test("the route answers an ask for one place with no template fallback, and says so when the AI is busy", () => {
    expect(route).toContain("const item = await askPlatformCopy(story, platforms[0], ask,");
    expect(route).toContain('"ai_busy"');
    expect(creative).toContain("Never invent anything about the video");
    expect(creative).toMatch(/if \(!m\) return null;/);
  });
  test("the page sends one ask at a time and always lands it as a suggestion", () => {
    const fn = ws.slice(ws.indexOf("const askPip = async"), ws.indexOf("// Resuming a draft"));
    expect(fn).toContain("if (askingRef.current) return;");
    expect(fn).toContain("if (!navigator.onLine) return toast(");
    expect(fn).toContain('suggest(s, { t: "propose", p: pl, proposal })');
    expect(fn).not.toContain("fillAdapted");
    expect(fn).not.toContain("setDrafts");
    expect(acts).toContain("Nothing changes until you accept it.");
    expect(ws).toContain("pip={pipProps}");
  });
});

describe("R1198 Step 2: Your caption", () => {
  test("one editor titled Your caption with the brief's placeholder, a count and the autosave line", () => {
    expect(CAPTION_PLACEHOLDER).toBe("Write your caption, describe your video, or tell Pip what you want your audience to know...");
    expect(story).toContain('<label htmlFor="story-box">Your caption</label>');
    expect(story).toContain("<Counter value={p.story.length} max={ADAPT_MAX} />");
    expect(story).toContain('aria-describedby="story-box-status"');
    expect(ws).toContain("status={autosaveLine(saved, savedAt)}");
  });
  test("a full-width lime Generate captions with Pip AI, with Use my text as it is beside it", () => {
    expect(story).toContain('variant="lime" className="min-h-12 w-full rounded-full px-5"');
    expect(story).toContain("Generate captions with Pip AI");
    expect(story).toContain("Use my text as it is");
  });
  test("each platform row has its count, Edit, one Regenerate, Copy and approval", () => {
    for (const s of ["Edit", "Regenerate", "Copy", "Approve", "Suggestion waiting", "Edited by you"]) expect(rows).toContain(s);
    expect(ws).toContain("onRegenerate={(pl) => void adapt([pl], { fresh: true, direct: true, tone: adaptTone ?? undefined })}");
    expect(ws).toContain("proposals={sugg.proposals}");
  });
  test("subtitles live in their own collapsed Video subtitles section, kept mounted", () => {
    expect(subs).toContain("Video subtitles");
    expect(subs).toContain("Transcribe spoken words and synchronize subtitles with your video.");
    expect(subs).toContain("useState(false)");
    expect(subs).toContain("hidden={!open}");
    expect(ws).toMatch(/<VideoSubtitles transcribing=\{capTranscribing\} burning=\{capBurning\}>\s*<CaptionBurner/);
    expect(subtitlesLine(0, false)).toBe("None yet");
    expect(subtitlesLine(1, false)).toBe("1 subtitle ready");
    expect(subtitlesLine(12, false)).toBe("12 subtitles ready");
    expect(subtitlesLine(12, true)).toContain("Transcribing");
  });
  test("Pip opens on Your Story; a phone keeps it as a card so a sheet never covers the actions", () => {
    expect(pipOpensOn("story", true)).toBe(true);
    expect(pipOpensOn("everywhere", false)).toBe(false);
    expect(ws).toContain('else if (step !== "story") {');
  });
  test("on a phone the video preview folds away and pauses", () => {
    expect(ws).toContain('aria-controls="stage-video"');
    expect(ws).toContain("capVideo.current?.pause(), setVideoShut((v) => !v)");
    expect(ws).toContain('className={cn(videoShut && "max-md:hidden")}');
  });
});

describe("R1198 Step 3: Everywhere", () => {
  test("the heading and the line under it", () => {
    expect(deck).toContain("Now let&apos;s make it <span");
    expect(deck).toContain("Review each platform&apos;s version. Make your final edits before publishing.");
    expect(deck).not.toContain("Your hook <Counter");
  });
  test("the original caption panel: folded, view, edit with a question, use for this platform", () => {
    for (const s of ["Original caption", "View original", "Edit source caption", "Use original caption", "Update platform captions too?", "Keep them as they are", "Keep this one"]) expect(deck).toContain(s);
    expect(deck).toContain('if (p.regenerable.length && p.onRegenerate) setAsk("regen");');
    expect(ws).toContain('onRegenerate={(pls) => void fetchCopy(pls, hook || firstSentence(story, 160), "rewrite")}');
  });
  test("one editor at a time, and the page knows which one Pip works on", () => {
    expect(deck).toContain("onActive?.(linked.length && !shut ? active : null);");
    expect(ws).toContain("onActive={setDeckActive}");
  });
  test("places with no account sit under Connect more platforms, preview only", () => {
    expect(deck).toContain(">Connect more platforms</h3>");
    expect(deck).toContain("Preview only until you connect. Nothing is sent there.");
  });
});

describe("R1198 review fixes", () => {
  test("an ask that comes back empty gives the credit back before saying Pip is busy", () => {
    expect(route).toContain('import { chargeAi, refundAi } from "@/lib/ai-quota";');
    expect(route).toContain('await refundAi(uid, charged, "ai", now);');
    expect(route.indexOf("refundAi(uid, charged")).toBeLessThan(route.indexOf("ai_busy", route.indexOf("refundAi(uid, charged")));
  });
  test("words Pip writes straight in are reviewed again, and a stale suggestion for that place is dropped", () => {
    const body = ws.slice(ws.indexOf("const fillAdapted = (c: PlatformCopy) => {"), ws.indexOf("const untouched = (pl: Platform)"));
    expect(body).toContain("reviewed: false");
    expect(body).toContain('suggest(s, { t: "reject", p: c.platform })');
  });
  test("a place with no hashtags field (X) never offers the hashtags ask", () => {
    expect(acts).toContain('import { fieldsFor } from "./deck-logic";');
    expect(acts).toContain('.filter((a) => a.id !== "hashtags" || !t || fieldsFor(t).hashtags)');
  });
  test("burning captions opens the subtitles section too", () => {
    expect(subs).toContain("burning");
    expect(ws).toContain("burning={capBurning}");
  });
});
