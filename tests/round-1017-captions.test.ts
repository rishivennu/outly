import { describe, expect, test } from "bun:test";
import { DEFAULT_RULES, enginePrompt, mergeRules, polish, whyLine } from "../lib/ai/caption-engine";

describe("caption engine guard rails", () => {
  test("drops banned and duplicate hashtags and caps the count", () => {
    const { copy, fixes } = polish("instagram", { caption: "Hook", hashtags: "#fyp #bakery #Bakery #sourdough #viral #reelsdaily #smallbusiness #bread #baking #morning" });
    expect(copy.hashtags).toBe("#bakery #sourdough #smallbusiness #bread #baking");
    expect(fixes).toContain("Removed hashtags that hurt reach");
  });

  test("X and Threads tag limits", () => {
    expect(polish("x", { caption: "One idea.", hashtags: "#a #b" }).copy.hashtags).toBe("");
    expect(polish("threads", { caption: "One idea.", hashtags: "#baking #bread" }).copy.hashtags).toBe("#baking");
  });

  test("YouTube keeps #Shorts last and never alone", () => {
    expect(polish("youtube", { caption: "", title: "T", description: "D", hashtags: "#Shorts #a #b #c #d #e" }).copy.hashtags).toBe("#a #b #c #d #Shorts");
    expect(polish("youtube", { caption: "", title: "T", description: "D", hashtags: "#Shorts" }).copy.hashtags).toBe("");
  });

  test("strips engagement bait lines and em dashes", () => {
    const { copy, fixes } = polish("instagram", { caption: "We went from 0 to 10k — here's how.\n\nLike if you agree!\n\nSend this to a friend who bakes.", hashtags: "" });
    expect(copy.caption).toBe("We went from 0 to 10k, here's how.\n\nSend this to a friend who bakes.");
    expect(fixes).toContain("Removed engagement bait");
  });

  test("swaps Facebook trigger words but keeps 'feel free'", () => {
    const { copy } = polish("facebook", { caption: "FREE guide inside. Click here and feel free to share.", hashtags: "" });
    expect(copy.caption).toBe("No cost guide inside. Learn more and feel free to share.");
    expect(polish("instagram", { caption: "FREE guide", hashtags: "" }).copy.caption).toBe("FREE guide");
  });

  test("tag lines at the end of the text move into the hashtags field", () => {
    const { copy } = polish("youtube", { caption: "", title: "T", description: "Hook line.\n\nSubscribe for more.\n\n#sourdough #baking #Shorts", hashtags: "#sourdough #baking #Shorts" });
    expect(copy.description).toBe("Hook line.\n\nSubscribe for more.");
    expect(copy.hashtags).toBe("#sourdough #baking #Shorts");
    expect(polish("instagram", { caption: "Body #inline stays\n#extra #tags", hashtags: "#a" }).copy).toMatchObject({ caption: "Body #inline stays", hashtags: "#a #extra #tags" });
  });

  test("hard caps per platform", () => {
    expect(polish("x", { caption: "word ".repeat(100), hashtags: "" }).copy.caption.length).toBeLessThanOrEqual(280);
    expect(polish("youtube", { caption: "", title: "x".repeat(130), description: "", hashtags: "" }).copy.title!.length).toBeLessThanOrEqual(100);
  });

  test("stored rules merge over defaults and survive junk", () => {
    expect(mergeRules(null)).toBe(DEFAULT_RULES);
    const m = mergeRules({ platforms: { threads: { tags: [0, 2], rules: "nope" } }, bannedTags: ["spam"], fbTriggers: { x: 1 } });
    expect(m.platforms.threads.tags).toEqual([0, 2]);
    expect(m.platforms.threads.rules).toEqual(DEFAULT_RULES.platforms.threads.rules);
    expect(m.bannedTags).toEqual(["spam"]);
    expect(m.fbTriggers).toEqual(DEFAULT_RULES.fbTriggers);
    expect(m.platforms.instagram).toEqual(DEFAULT_RULES.platforms.instagram);
  });

  test("prompt only covers the chosen platforms and the why line reads well", () => {
    const p = enginePrompt(DEFAULT_RULES, ["instagram", "x"]);
    expect(p).toContain("### instagram (Instagram Reels)");
    expect(p).toContain("### x (X)");
    expect(p).not.toContain("### tiktok");
    expect(p).not.toContain("—");
    expect(whyLine({ formula: "Myth Buster", hook: "Curiosity", cta: "Save", signal: "saves" })).toBe("Myth Buster · Curiosity hook · optimised for saves");
    expect(whyLine(undefined)).toBe("");
  });
});
