/** Phase 4 deck: preview-only places (9), one hook on Steps 3-4 (4), the per-place summary on Launch (11), 44px Edit (10). */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Draft } from "../lib/client/checks";
import { PLATFORMS, PLATFORM_META, type Platform } from "../lib/domain";
import { bodyKey, fieldsFor, previewDraft, previewNote } from "../components/create/deck-logic";
import { diffRows, launchPlan, targetPayload } from "../components/create/publish";
import { foldsConversation } from "../components/create/assistant-state";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const draft = (o: Partial<Draft> = {}): Draft => ({ enabled: true, title: "", caption: "", description: "", hashtags: "", firstComment: "", note: "", reviewed: false, ...o });
const drafts = (o: Partial<Record<Platform, Partial<Draft>>> = {}) => Object.fromEntries(PLATFORMS.map((p) => [p, draft({ enabled: false, ...(o[p] ?? {}) })])) as Record<Platform, Draft>;

describe("p4 preview for a place that is not connected", () => {
  const ig = { enabled: true, caption: "Most people burn out in a week.", hashtags: "#morning #routine" };

  test("its own words win and are shown as they are", () => {
    const d = drafts({ instagram: ig, youtube: { title: "Own title", description: "Own words" } });
    const r = previewDraft("youtube", d, "You are waking up wrong");
    expect(r.source).toBe("own");
    expect(r.draft).toBe(d.youtube);
  });

  test("with no words it borrows the first place with words, fitted to its rules", () => {
    const d = drafts({ instagram: ig });
    const x = previewDraft("x", d, "You are waking up wrong");
    expect(x.source).toBe("instagram");
    expect(x.draft.caption).toBe(ig.caption);
    if (!fieldsFor("x").hashtags) expect(x.draft.hashtags).toBe("");
    expect(x.draft.caption.length).toBeLessThanOrEqual(PLATFORM_META.x.captionLimit);
    const yt = previewDraft("youtube", d, "You are waking up wrong\nsecond line");
    expect(yt.draft.title).toBe("You are waking up wrong");
    expect(yt.draft[bodyKey("youtube")]).toBe(ig.caption);
  });

  test("a long caption is trimmed to the place's room, never past it", () => {
    const long = "word ".repeat(200).trim();
    const r = previewDraft("x", drafts({ instagram: { enabled: true, caption: long } }), "");
    expect(r.draft.caption.length).toBeLessThanOrEqual(PLATFORM_META.x.captionLimit);
    expect(long.startsWith(r.draft.caption)).toBe(true);
  });

  test("a shared main caption is named as the main caption", () => {
    const d = drafts({ instagram: { enabled: true, caption: "Same words" }, tiktok: { enabled: true, caption: "Same words" } });
    expect(previewDraft("x", d, "").source).toBe("main");
  });

  test("only the hook to go on: YouTube shows it as the title", () => {
    const r = previewDraft("youtube", drafts(), "Hook line");
    expect(r.source).toBe("hook");
    expect(r.draft.title).toBe("Hook line");
  });

  test("nothing at all: the empty draft, so the preview shows its own placeholders", () => {
    const d = drafts();
    expect(previewDraft("x", d, "")).toEqual({ draft: d.x, source: "own" });
  });

  test("the preview never touches the drafts, so nothing borrowed can be sent", () => {
    const d = drafts({ instagram: ig });
    const before = JSON.stringify(d);
    previewDraft("x", d, "Hook");
    previewDraft("youtube", d, "Hook");
    expect(JSON.stringify(d)).toBe(before);
    expect(targetPayload(d).map((t) => t.platform)).toEqual(["instagram"]);
    expect(launchPlan(d, { instagram: { status: "connected" } }, null).send).not.toContain("x");
  });

  test("the note says whose words it shows and that nothing is sent", () => {
    expect(previewNote("x", "instagram")).toBe("Shown with your Instagram caption. Nothing is sent to X until you connect it and switch it on.");
    expect(previewNote("youtube", "hook")).toContain("hook as the title");
    expect(previewNote("x", "own")).toBe("Nothing is sent to X until you connect it and switch it on.");
    for (const s of ["own", "main", "hook", "instagram"] as const) expect(previewNote("x", s)).not.toMatch(/will (be )?(send|sent|post)|scheduled|published/i);
  });

  test("the deck wires it: no send control for a place that cannot send, a muted Connect to send state", () => {
    const deck = src("components/create/PlatformDeck.tsx");
    const pane = src("components/create/PlatformPreview.tsx");
    expect(deck).toContain("previewDraft(active, p.drafts, p.hook)");
    expect(deck).toContain("Connect to send");
    expect(deck).toContain("const previewOnly = !connected && !d.enabled;");
    expect(deck).toContain("{previewOnly ? null : (");
    expect(pane).toContain("Connect to send");
    expect(pane).toContain("useState(!!previewOnly)");
  });
});

describe("p4 the hook once on Everywhere and Launch", () => {
  test("only Everywhere and Launch fold the conversation", () => {
    expect(foldsConversation("everywhere")).toBe(true);
    expect(foldsConversation("launch")).toBe(true);
    expect(foldsConversation("video")).toBe(false);
    expect(foldsConversation("story")).toBe(false);
  });
  test("the panel shows its latest message and a labelled disclosure for the rest", () => {
    const a = src("components/create/Assistant.tsx");
    expect(a).toContain("const folds = foldsConversation(p.step) && !!p.chosenHook;");
    expect(a).toContain('{unfolded ? "Hide conversation" : "Show conversation"}');
    expect(a).toContain("aria-expanded={unfolded}");
    expect(a).toContain("aria-controls={historyId}");
    expect(a).toContain("{showHistory && (");
    // the Suggested hook card sits inside the folded part, the Launch line outside it
    expect(a.indexOf("{showHistory && (")).toBeLessThan(a.indexOf("Suggested</p>"));
    expect(a.indexOf("Suggested</p>")).toBeLessThan(a.indexOf('{p.step === "launch" &&'));
  });
});

describe("p4 Launch summary per place", () => {
  test("one place: nothing to compare", () => {
    expect(diffRows(drafts({ instagram: { caption: "Hi" } }), ["instagram"])).toEqual([]);
  });
  test("two places: first line, hashtags sent and format for each", () => {
    const d = drafts({
      instagram: { caption: "\n  First line here\nsecond", hashtags: "#a #b #c" },
      youtube: { title: "A searchable title", description: "Body #shorts", hashtags: "#x" },
      x: { caption: "Short and sharp #tag" },
    });
    const rows = diffRows(d, ["instagram", "youtube", "x"]);
    expect(rows).toEqual([
      { platform: "instagram", format: PLATFORM_META.instagram.format, firstLine: "First line here", hashtags: 3 },
      { platform: "youtube", format: PLATFORM_META.youtube.format, firstLine: "A searchable title", hashtags: 2 },
      { platform: "x", format: PLATFORM_META.x.format, firstLine: "Short and sharp #tag", hashtags: 1 },
    ]);
  });
  test("YouTube with no title falls back to its description; empty words stay empty", () => {
    const rows = diffRows(drafts({ youtube: { description: "Desc line" }, tiktok: {} }), ["youtube", "tiktok"]);
    expect(rows[0].firstLine).toBe("Desc line");
    expect(rows[1].firstLine).toBe("");
    expect(rows[1].hashtags).toBe(0);
  });
  test("the panel shows the rows for 2+ places and keeps the Edit target at 44px", () => {
    const lp = src("components/create/LaunchPanel.tsx");
    expect(lp).toContain("diffRows(p.drafts, rows.map((r) => r.platform))");
    expect(lp).toContain('aria-label="What each place gets"');
    expect(lp).toContain('className="min-h-11 shrink-0" aria-label="Edit the post in Everywhere"');
    expect(lp).toContain("tabular-nums");
  });
});

describe("p4 deck design rules", () => {
  test("no dashes, no transition-all, no text under 12px in the files touched", () => {
    for (const f of ["PlatformDeck.tsx", "PlatformPreview.tsx", "LaunchPanel.tsx", "Assistant.tsx", "assistant-state.ts", "deck-logic.ts", "publish.ts"]) {
      const s = src(`components/create/${f}`);
      expect(s, f).not.toMatch(/[\u2013\u2014]/);
      expect(s, f).not.toContain("transition-all");
      expect(s, f).not.toMatch(/text-\[(1[01]|[0-9])px\]/);
    }
    expect(src("components/create/Assistant.tsx")).not.toContain("min-h-[36px]");
  });
});
