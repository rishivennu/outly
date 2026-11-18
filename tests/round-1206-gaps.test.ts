/**
 * R1206 Content Studio, the four open gaps. 3: Pip's asks on Your Story edit the creator's own caption, and the
 * answer waits under the box to apply or skip. 6: when the caption changes after Pip wrote the platforms, the
 * creator updates all, some or none of them. 7: Pip's results show one platform at a time, behind tabs. 8: Launch
 * says what is ready and puts the one fix next to each held platform.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Draft } from "../lib/client/checks";
import { PLATFORMS, PLATFORM_META, type Platform } from "../lib/domain";
import { captionState } from "../components/create/AdaptedCaptions";
import { FIX_LABEL, holdOf, launchPlan, readinessLine } from "../components/create/publish";
import { withHashtags, splitStory, ADAPT_MAX } from "../lib/ai/adapt-core";
import { captionAskRequestSchema } from "../lib/validation";
import { CAPTION_ASKS, CAPTION_ASK_RULE, isCaptionAsk, STORY_ASKS } from "../lib/ai/pip-asks";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const draft = (o: Partial<Draft> = {}): Draft => ({ enabled: true, title: "", caption: "", description: "", hashtags: "", firstComment: "", note: "", reviewed: false, ...o });
const drafts = (o: Partial<Record<Platform, Partial<Draft>>> = {}) => Object.fromEntries(PLATFORMS.map((p) => [p, draft({ enabled: false, ...(o[p] ?? {}) })])) as Record<Platform, Draft>;

describe("gap 7: one platform at a time", () => {
  const base = { busy: false, proposal: false, reviewed: false, empty: false, mine: false };
  test("the state in a word or two, first one wins", () => {
    expect(captionState({ ...base, busy: true, proposal: true, reviewed: true }).label).toBe("Writing…");
    expect(captionState({ ...base, proposal: true, reviewed: true }).label).toBe("Suggestion waiting");
    expect(captionState({ ...base, reviewed: true, mine: true }).label).toBe("Approved");
    expect(captionState({ ...base, empty: true, mine: true }).label).toBe("Not written yet");
    expect(captionState({ ...base, mine: true }).label).toBe("Edited by you");
    expect(captionState(base)).toEqual({ kind: "ready", label: "Ready to review" });
  });

  test("tabs pick the platform and only that one is rendered", () => {
    const s = src("components/create/AdaptedCaptions.tsx");
    expect(s).toContain('role="tablist"');
    expect(s).toContain('role="tabpanel"');
    expect(s).toContain("<Row key={sel} platform={sel}");
    expect(s).not.toContain("motion.li");
    for (const k of ['"ArrowRight"', '"ArrowLeft"', '"Home"', '"End"']) expect(s).toContain(k);
  });
});

describe("gap 8: Launch says what is ready and how to fix the rest", () => {
  const ok = { status: "connected" };
  test("each hold names the one fix, connection first", () => {
    const d = drafts({ instagram: { enabled: true, caption: "Thirty days of 5am, here is what worked.", reviewed: true } });
    expect(holdOf("instagram", d, {}, null)?.fix).toBe("connect");
    expect(holdOf("instagram", d, { instagram: { status: "expired" } }, null)?.fix).toBe("reconnect");
    expect(holdOf("instagram", d, { instagram: ok }, null, ["instagram"])).toEqual({ reason: "A suggestion is waiting.", fix: "suggestion" });
    expect(holdOf("instagram", { ...d, instagram: { ...d.instagram, reviewed: false } }, { instagram: ok }, null)?.fix).toBe("review");
  });

  test("launchPlan still holds the same places with the same reasons", () => {
    const d = drafts({ instagram: { enabled: true, caption: "Words", reviewed: true }, tiktok: { enabled: true, caption: "Words" } });
    const plan = launchPlan(d, { instagram: ok, tiktok: ok }, null);
    const igHold = holdOf("instagram", d, { instagram: ok }, null);
    expect(plan.send.includes("instagram")).toBe(!igHold);
    expect(plan.hold.find((h) => h.platform === "tiktok")?.reason).toBe(holdOf("tiktok", d, { tiktok: ok }, null)?.reason);
  });

  test("every fix has a plain label", () => {
    expect(FIX_LABEL).toEqual({ connect: "Connect", reconnect: "Reconnect", video: "Replace video", check: "Fix it", suggestion: "Review the suggestion", review: "Look it over" });
  });

  test("a video that is too long is fixed by replacing it, not on Everywhere", () => {
    const d = drafts({ instagram: { enabled: true, caption: "Words", reviewed: true } });
    const long = { duration: PLATFORM_META.instagram.maxDurationSec + 30, width: 1080, height: 1920 };
    expect(holdOf("instagram", d, { instagram: ok }, long)?.fix).toBe("video");
    const lp = src("components/create/LaunchPanel.tsx");
    expect(lp).toContain('r.fix === "video" ? p.onReplaceVideo() : p.onFix(r.platform)');
    expect(lp).toContain("`for ${name}, in Everywhere`");
  });

  test("the readiness line", () => {
    expect(readinessLine([])).toBe("Nothing is switched on yet.");
    expect(readinessLine([{ sending: true }])).toBe("Ready to go.");
    expect(readinessLine([{ sending: true }, { sending: true }])).toBe("All 2 are ready to go.");
    expect(readinessLine([{ sending: true }, { sending: false }])).toBe("1 of 2 ready. Fix the one below or leave it out.");
    expect(readinessLine([{ sending: false }, { sending: false }, { sending: true }])).toBe("1 of 3 ready. Fix the 2 below or leave them out.");
  });

  test("the panel wires Connect and Fix it, and Everywhere opens on that platform", () => {
    const lp = src("components/create/LaunchPanel.tsx");
    expect(lp).toContain("onConnect");
    expect(lp).toContain("onFix");
    expect(lp).toContain("readinessLine(");
    expect(lp).toContain('role="status"');
    const cw = src("components/create/CreateWorkspace.tsx");
    expect(cw).toContain("onConnect={(p) => void connect(p)}");
    expect(cw).toContain("onFix={fixOnDeck}");
    expect(cw).toContain("open={deckOpen}");
    expect(src("components/create/PlatformDeck.tsx")).toContain("open?: Platform | null");
  });
});

describe("gap 6: the caption changed after Pip wrote the platforms", () => {
  test("update all, choose some, or keep them", () => {
    const s = src("components/create/StoryComposer.tsx");
    // The card waits for a pause in typing, and only Generate gives way to it: "Use my text as it is" stays.
    expect(s).toContain("setTimeout(() => setArmed(true), 900)");
    expect(s).toContain(") : stale ? null : (");
    expect(s).not.toContain('stale && "hidden"');
    expect(s).toContain("Your caption changed since Pip wrote your platform captions.");
    expect(s).toContain("Choose platforms");
    expect(s).toContain("Keep them as they are");
    expect(s).toContain("`Update all ${places.length}`");
  });

  test("the page passes the stale check and updates only the chosen places", () => {
    const cw = src("components/create/CreateWorkspace.tsx");
    expect(cw).toContain("changed={someAdapted && !!submittedStory && story.trim() !== submittedStory.trim()}");
    expect(cw).toContain("void adapt(pls, { fresh: true, tone: adaptTone ?? undefined, update: true });");
  });
});

describe("gap 3: Pip's asks on Your Story edit the original caption", () => {
  test("the caption asks are the story chips, less the one that adds a platform", () => {
    expect([...CAPTION_ASKS]).toEqual(STORY_ASKS.filter((a) => a.id !== "other").map((a) => a.id) as string[]);
    for (const a of CAPTION_ASKS) expect(CAPTION_ASK_RULE[a].length).toBeGreaterThan(20);
    expect(isCaptionAsk("hook")).toBe(true);
    expect(isCaptionAsk("adapt")).toBe(false);
    expect(isCaptionAsk("other")).toBe(false);
  });

  test("hashtags go on their own labelled line, replacing the one there", () => {
    expect(withHashtags("My morning, fixed.", "#morning #routine")).toBe("My morning, fixed.\nHashtags: #morning #routine");
    expect(withHashtags("My morning.\nHashtags: #old\nCTA: follow", "#new")).toBe("My morning.\nHashtags: #new\nCTA: follow");
    expect(withHashtags("", "#a")).toBe("Hashtags: #a");
    expect(withHashtags("x".repeat(ADAPT_MAX), "#a").length).toBeLessThanOrEqual(ADAPT_MAX);
    expect(splitStory(withHashtags("My morning, fixed.", "#morning #routine")).body).toBe("My morning, fixed.");
  });

  test("the request is the caption and one caption ask", () => {
    expect(captionAskRequestSchema.parse({ text: "My morning, fixed.", ask: "shorter" })).toEqual({ text: "My morning, fixed.", ask: "shorter" });
    expect(captionAskRequestSchema.safeParse({ text: "hi", ask: "shorter" }).success).toBe(false);
    expect(captionAskRequestSchema.safeParse({ text: "My morning, fixed.", ask: "adapt" }).success).toBe(false);
    expect(captionAskRequestSchema.safeParse({ text: "x".repeat(4001), ask: "hook" }).success).toBe(false);
  });

  test("the route refunds and says so when no model answered", () => {
    const r = src("app/api/ai/caption/route.ts");
    expect(r).toContain("captionAskRequestSchema.parse");
    expect(r).toContain("refundAi(");
    expect(r).toContain('"ai_busy"');
    expect(r).toContain('"rewrite"');
    expect(r).toContain('if (out.text.trim() === text.trim()) await refundAi(uid, charged, "ai", now);');
    const a = src("lib/ai/adapt.ts");
    expect(a).toContain("No em dashes or en dashes");
    expect(a).toContain("bannedTags");
  });

  test("Your Story has no 'For' picker; the asks go to the caption", () => {
    const pa = src("components/create/PipActions.tsx");
    expect(pa).not.toContain("Which place Pip works on");
    expect(pa).not.toContain("onTarget");
    expect(pa).toContain("cap.onAsk(a.id)");
    expect(pa).toContain("Working on your caption…");
    const cw = src("components/create/CreateWorkspace.tsx");
    expect(cw).toContain('"/api/ai/caption"');
    expect(cw).toContain("caption: { busy: captionAsk, waiting: !!captionProposal, onAsk: (a) => void askCaption(a) }");
    expect(cw).not.toContain("onTarget");
  });

  test("the answer waits under Your caption to apply or skip", () => {
    const s = src("components/create/StoryComposer.tsx");
    expect(s).toContain("Pip&apos;s suggestion for your caption");
    expect(s).toContain("Apply it");
    expect(s).toContain("onClick={p.onSkip}");
    expect(s).toContain("You edited your caption after asking.");
    const cw = src("components/create/CreateWorkspace.tsx");
    expect(cw).toContain("setStory(captionProposal.text);");
    expect(cw).toContain("onSkip={() => setCaptionProposal(null)}");
    // A restore or the server's copy replaces the story, and takes any waiting suggestion with it.
    expect(cw.match(/setCaptionProposal\(null\);/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    // Every tab is selectable, written or not: the raw focus goes in, AdaptedCaptions falls back itself.
    expect(cw).toContain("focus={pipFocus}");
  });
});

describe("R1206 gaps: copy rules", () => {
  const files = [
    "components/create/AdaptedCaptions.tsx",
    "components/create/publish.ts",
    "components/create/LaunchPanel.tsx",
    "components/create/PlatformDeck.tsx",
    "components/create/ActionBar.tsx",
    "components/create/StoryComposer.tsx",
    "components/create/PipActions.tsx",
    "lib/ai/pip-asks.ts",
    "app/api/ai/caption/route.ts",
  ];
  test.each(files)("%s has no en or em dashes and no transition-all", (f) => {
    const s = src(f);
    expect(s).not.toMatch(/[\u2013\u2014]/);
    expect(s).not.toContain("transition-all");
  });
  test("no text under 12px on Launch and Everywhere", () => {
    for (const f of ["components/create/LaunchPanel.tsx", "components/create/PlatformDeck.tsx", "components/create/StoryComposer.tsx"]) expect(src(f)).not.toMatch(/text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/);
  });
});
