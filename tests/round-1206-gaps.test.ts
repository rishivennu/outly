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
import { CARD_LABEL, canApprove, cardKind } from "../components/create/CaptionCards";
import { APPROVE, FRESH, REVIEW_LABEL, reviewKind, withEditState } from "../components/create/review-state";
import { FIX_LABEL, holdOf, launchPlan, readinessLine } from "../components/create/publish";
import { withHashtags, splitStory, ADAPT_MAX } from "../lib/ai/adapt-core";
import { captionAskRequestSchema } from "../lib/validation";
import { CAPTION_ASKS, CAPTION_ASK_RULE, isCaptionAsk, STORY_ASKS } from "../lib/ai/pip-asks";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const draft = (o: Partial<Draft> = {}): Draft => ({ enabled: true, title: "", caption: "", description: "", hashtags: "", firstComment: "", note: "", reviewed: false, ...o });
const drafts = (o: Partial<Record<Platform, Partial<Draft>>> = {}) => Object.fromEntries(PLATFORMS.map((p) => [p, draft({ enabled: false, ...(o[p] ?? {}) })])) as Record<Platform, Draft>;

// R1209 replaced gap 7's tabs: every switched-on platform gets one compact card on Everywhere, in three states.
describe("R1209: one card per platform, three states, only Approved goes out", () => {
  const words = draft({ caption: "Thirty days of 5am, here is what worked." });
  test("the state in a word or two, first one wins", () => {
    expect(cardKind({ busy: true, proposal: true, draft: { ...words, reviewed: true } })).toBe("writing");
    expect(cardKind({ busy: false, proposal: true, draft: { ...words, reviewed: true } })).toBe("proposal");
    expect(cardKind({ busy: false, proposal: false, draft: draft() })).toBe("empty");
    expect(cardKind({ busy: false, proposal: false, draft: { ...words, ...APPROVE } })).toBe("approved");
    expect(cardKind({ busy: false, proposal: false, draft: { ...words, ...FRESH, edited: true } })).toBe("edited");
    expect(cardKind({ busy: false, proposal: false, draft: { ...words, ...FRESH } })).toBe("needs-review");
    expect(Object.values(REVIEW_LABEL)).toEqual(["Needs review", "Edited", "Approved"]);
    expect(CARD_LABEL.writing).toBe("Writing…");
    expect(CARD_LABEL.proposal).toBe("Suggestion waiting");
  });

  test("typing on Needs review is Edited; typing on Approved goes back to Needs review; Pip's words start over", () => {
    const fresh = { ...words, ...FRESH };
    const typed = { ...fresh, ...withEditState(fresh, { caption: "My own words now." }) };
    expect(reviewKind(typed)).toBe("edited");
    const approved = { ...typed, ...withEditState(typed, APPROVE) };
    expect(reviewKind(approved)).toBe("approved");
    const reopened = { ...approved, ...withEditState(approved, { caption: "One more change." }) };
    expect(reopened.reviewed).toBe(false);
    expect(reviewKind(reopened)).toBe("needs-review");
    // Still Needs review while typing goes on, until it is approved again.
    expect(reviewKind({ ...reopened, ...withEditState(reopened, { caption: "And another." }) })).toBe("needs-review");
    // Switching a place on or off is not an edit.
    expect(withEditState(fresh, { enabled: false })).toEqual({ enabled: false });
    // Regenerate and an accepted suggestion are Pip's words: Needs review again.
    expect(reviewKind({ ...approved, ...withEditState(approved, FRESH) })).toBe("needs-review");
  });

  test("only words with nothing waiting and nothing failing can be approved", () => {
    expect(canApprove({ busy: false, proposal: false, blocked: false, draft: words })).toBe(true);
    expect(canApprove({ busy: true, proposal: false, blocked: false, draft: words })).toBe(false);
    expect(canApprove({ busy: false, proposal: true, blocked: false, draft: words })).toBe(false);
    expect(canApprove({ busy: false, proposal: false, blocked: true, draft: words })).toBe(false);
    expect(canApprove({ busy: false, proposal: false, blocked: false, draft: draft({ hashtags: "#a" }) })).toBe(false);
  });

  test("a grid of cards with Approve all, and the words changed in the one editor below", () => {
    const s = src("components/create/CaptionCards.tsx");
    expect(s).toContain('<ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">');
    expect(s).not.toContain('role="tablist"');
    expect(s).not.toContain("<Textarea");
    expect(s).toContain("toApprove.forEach((pl) => p.onDraft(pl, APPROVE))");
    expect(s).toContain("Only approved captions are published.");
    const deck = src("components/create/PlatformDeck.tsx");
    expect(deck).toContain("onEdit={editOne}");
    expect(deck).toContain('panel?.querySelector<HTMLElement>("[data-body]")?.focus({ preventScroll: true });');
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
  // R1209: no update card on Your Story any more. Coming into Everywhere with a changed caption writes every place
  // again; a place the creator edited gets a suggestion instead of an overwrite.
  test("Your Story has no update card; the caption is only written there", () => {
    const s = src("components/create/StoryComposer.tsx");
    expect(s).not.toContain("Your caption changed since Pip wrote your platform captions.");
    expect(s).not.toContain("Choose platforms");
  });

  test("Everywhere writes once per caption and set of places, all of them when the caption changed", () => {
    const cw = src("components/create/CreateWorkspace.tsx");
    const fx = cw.slice(cw.indexOf("const adaptTried = useRef(\"\");"), cw.indexOf("const onDraft = (p: Platform"));
    expect(fx).toContain('if (step !== "everywhere" || phase !== "edit") {');
    expect(fx).toContain("const changed = submittedStory != null && caption !== submittedStory.trim();");
    // R1209 A2: each place remembers the caption it was written from, so only the stale ones are written again.
    expect(fx).toContain("const todo = staleFor(from, adaptPlaces, caption, (pl) => changed || (!hasCopy(draftsRef.current[pl]) && !adaptedRef.current[pl]));");
    expect(fx).toContain("if (adaptTried.current === key) return;");
    expect(fx).toContain("void adapt(todo, { direct: !again && someAdapted, update: again && todo.length < adaptPlaces.length, tone: adaptTone ?? undefined });");
  });
});

describe("gap 3: Pip's asks on Your Story edit the original caption", () => {
  test("the caption asks are the story chips, less the one that adds a platform", () => {
    // R1209 A1: plus Rephrase, Write my own's one button.
    expect([...CAPTION_ASKS].filter((a) => a !== "rephrase")).toEqual(STORY_ASKS.filter((a) => a.id !== "other").map((a) => a.id) as string[]);
    expect(CAPTION_ASKS).toContain("rephrase");
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
    // R1209 A1: the original and the suggestion side by side, then Accept, Edit or Keep.
    expect(s).toContain("Suggested caption");
    expect(s).toContain("Accept suggestion");
    expect(s).toContain("Edit suggestion");
    expect(s).toContain("onClick={p.onSkip}");
    expect(s).toContain("You edited your caption after asking.");
    const cw = src("components/create/CreateWorkspace.tsx");
    expect(cw).toContain("setStory(captionProposal.text);");
    expect(cw).toContain("const m = acceptRewrite(metaRef.current, story, captionProposal.text);");
    expect(cw).toContain("onSkip={() => setCaptionProposal(null)}");
    // A restore or the server's copy replaces the story, and takes any waiting suggestion with it.
    expect(cw.match(/setCaptionProposal\(null\);/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe("R1206 gaps: copy rules", () => {
  const files = [
    "components/create/CaptionCards.tsx",
    "components/create/review-state.ts",
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
    for (const f of ["components/create/LaunchPanel.tsx", "components/create/PlatformDeck.tsx", "components/create/StoryComposer.tsx", "components/create/CaptionCards.tsx"]) expect(src(f)).not.toMatch(/text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/);
  });
});
