/** Phase 3 B-deck: the Everywhere step's pure rules (main caption, custom detection, supported fields, suggestions). */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { checksFor, countHashtags, type Draft } from "../lib/client/checks";
import { PLATFORMS, PLATFORM_META, type Platform } from "../lib/domain";
import { targetPayload } from "../components/create/publish";
import { acceptProposal, applyUndo, aspectOf, bodyKey, bodyRoom, clipTo, commonCaption, fieldsFor, isCustom, mainCaption, nextIndex, normalizeTags, proposalChanges, propagateMain } from "../components/create/deck-logic";

const draft = (o: Partial<Draft> = {}): Draft => ({ enabled: true, title: "", caption: "", description: "", hashtags: "", firstComment: "", note: "", reviewed: false, ...o });
const drafts = (o: Partial<Record<Platform, Partial<Draft>>> = {}) => Object.fromEntries(PLATFORMS.map((p) => [p, draft({ enabled: false, ...(o[p] ?? {}) })])) as Record<Platform, Draft>;
const apply = (d: Record<Platform, Draft>, patches: ReturnType<typeof propagateMain>) => {
  const next = { ...d };
  for (const { platform, patch } of patches) next[platform] = { ...next[platform], ...patch };
  return next;
};

describe("supported fields per platform", () => {
  test("YouTube: title 100 (required), description, hashtags, first comment, cover on Launch; no visibility", () => {
    const f = fieldsFor("youtube");
    expect(f.title).toMatchObject({ limit: 100, required: true });
    expect(f.body).toMatchObject({ key: "description", label: "Description", limit: 5000 });
    expect(f.hashtags).toBe(true);
    expect(f.firstComment?.limit).toBe(10000);
    expect(f.cover).toBe("upload");
    expect(Object.keys(f)).not.toContain("visibility");
  });
  test("Instagram: caption, hashtags, first comment, no title", () => {
    const f = fieldsFor("instagram");
    expect(f.title).toBeNull();
    expect(f.body.key).toBe("caption");
    expect(f.hashtags).toBe(true);
    expect(f.firstComment?.limit).toBe(2200);
  });
  test("X: a 280 post and a first reply, no hashtags field, no title", () => {
    const f = fieldsFor("x");
    expect(f).toMatchObject({ title: null, hashtags: false, body: { label: "Post", limit: 280 } });
    expect(f.firstComment?.label).toBe("First reply");
  });
  test("LinkedIn and Facebook get the title their publishers send; TikTok and Threads do not; no first comment for them", () => {
    expect(fieldsFor("linkedin").title).toMatchObject({ limit: 200, required: false });
    expect(fieldsFor("facebook").title).toMatchObject({ limit: null, required: false });
    for (const p of ["tiktok", "threads"] as const) expect(fieldsFor(p).title).toBeNull();
    for (const p of ["tiktok", "threads", "facebook", "linkedin"] as const) expect(fieldsFor(p).firstComment).toBeNull();
    const li = readFileSync(new URL("../lib/social/linkedin.ts", import.meta.url), "utf8");
    const fb = readFileSync(new URL("../lib/social/facebook.ts", import.meta.url), "utf8");
    expect(li).toContain("ctx.content.title");
    expect(fb).toContain("ctx.content.title");
  });
});

describe("main caption", () => {
  test("propagates to every enabled place that follows it, never to custom or switched off ones", () => {
    const d = drafts({ instagram: { enabled: true, caption: "Old words" }, tiktok: { enabled: true, caption: "Old words" }, threads: { enabled: true, caption: "Mine only", custom: true }, facebook: { enabled: false, caption: "Old words" }, youtube: { enabled: true, description: "Old words" } });
    expect(mainCaption(d)).toBe("Old words");
    const next = apply(d, propagateMain(d, "New words"));
    expect(next.instagram.caption).toBe("New words");
    expect(next.tiktok.caption).toBe("New words");
    expect(next.youtube.description).toBe("New words");
    expect(next.threads.caption).toBe("Mine only");
    expect(next.facebook.caption).toBe("Old words");
    for (const p of ["instagram", "tiktok", "youtube"] as const) expect(next[p].custom).toBe(false);
  });
  test("respects each place's own limit, counting its hashtags", () => {
    const long = "word ".repeat(200).trim(); // 999 chars
    const d = drafts({ instagram: { enabled: true }, x: { enabled: true }, threads: { enabled: true, hashtags: "#a #b" } });
    const patches = propagateMain(d, long, "");
    const next = apply(d, patches);
    expect(next.instagram.caption).toBe(long);
    expect(next.x.caption.length).toBeLessThanOrEqual(280);
    expect(next.threads.caption.length).toBeLessThanOrEqual(500 - "#a #b".length - 2);
    for (const p of ["x", "threads"] as const) expect(checksFor(p, next[p], null).some((c) => c.level === "error")).toBe(false);
    expect(patches.find((x) => x.platform === "x")?.trimmed).toBe(true);
    expect(patches.find((x) => x.platform === "instagram")?.trimmed).toBe(false);
  });
  test("clipTo cuts at a word when it can and never goes over", () => {
    expect(clipTo("short", 10)).toBe("short");
    expect(clipTo("hello brave new world", 15)).toBe("hello brave new");
    expect(clipTo("a".repeat(50), 20)).toHaveLength(20);
    expect(bodyRoom("x", { hashtags: "#ignored" })).toBe(280);
    expect(bodyRoom("instagram", { hashtags: "#ab" })).toBe(2200 - 5);
  });
  test("custom detection on load: a caption that differs from the most common one is custom", () => {
    const d = drafts({ instagram: { enabled: true, caption: "Same" }, tiktok: { enabled: true, caption: "Same" }, threads: { enabled: true, caption: "Different" }, linkedin: { enabled: true, caption: "" } });
    const main = commonCaption(d);
    expect(main).toBe("Same");
    expect(isCustom("instagram", d.instagram, main)).toBe(false);
    expect(isCustom("threads", d.threads, main)).toBe(true);
    expect(isCustom("linkedin", d.linkedin, main)).toBe(false); // empty follows the main caption
    // an X post that is the main caption trimmed to fit still follows it
    const long = "word ".repeat(100).trim();
    const dx = drafts({ instagram: { enabled: true, caption: long }, tiktok: { enabled: true, caption: long }, x: { enabled: true, caption: clipTo(long, 280) } });
    expect(isCustom("x", dx.x, commonCaption(dx))).toBe(false);
  });
  test("no two places agree: every place with words is its own, and the explicit flag always wins", () => {
    const d = drafts({ instagram: { enabled: true, caption: "A" }, tiktok: { enabled: true, caption: "B" } });
    expect(commonCaption(d)).toBe("");
    expect(isCustom("instagram", d.instagram, "")).toBe(true);
    expect(isCustom("instagram", { ...d.instagram, custom: false }, "")).toBe(false);
    expect(isCustom("instagram", { ...d.instagram, caption: "Same", custom: true }, "Same")).toBe(true);
    expect(propagateMain(d, "New", "")).toHaveLength(0);
    // a place set back to follow it is the main caption source when nothing is shared
    expect(mainCaption({ ...d, tiktok: { ...d.tiktok, custom: false } })).toBe("B");
  });
  test("the custom flag never reaches the server", () => {
    const d = drafts({ instagram: { enabled: true, caption: "Hi", custom: true } });
    const [t] = targetPayload(d);
    expect(Object.keys(t)).not.toContain("custom");
    expect(t.caption).toBe("Hi");
  });
});

describe("suggestions", () => {
  const before = draft({ title: "Old title", description: "Old desc", hashtags: "#old" });
  test("changes list only fields the platform supports and that actually change", () => {
    const changes = proposalChanges("youtube", before, { patch: { title: "New title", description: "Old desc", caption: "ignored on YouTube", firstComment: "Pinned" }, why: "Searchable" });
    expect(changes.map((c) => c.key)).toEqual(["title", "firstComment"]);
    expect(changes[0]).toMatchObject({ label: "Title", before: "Old title", after: "New title" });
    expect(proposalChanges("threads", draft(), { patch: { title: "No titles on Threads", firstComment: "nope" }, why: "" })).toHaveLength(0);
  });
  test("accept keeps the old values for revert, and revert puts every one back", () => {
    const proposal = { patch: { title: "New title", description: "New desc" }, why: "Clearer" };
    const { patch, undo } = acceptProposal("youtube", before, proposal);
    expect(undo).toMatchObject({ title: "Old title", description: "Old desc" });
    expect(patch).toMatchObject({ title: "New title", description: "New desc", custom: true });
    const accepted = { ...before, ...patch };
    expect(accepted.title).toBe("New title");
    const reverted = applyUndo(accepted, undo);
    expect(reverted.title).toBe("Old title");
    expect(reverted.description).toBe("Old desc");
    expect(reverted.custom).toBeUndefined();
  });
  test("a title only suggestion does not take the place off the main caption", () => {
    const { patch } = acceptProposal("youtube", before, { patch: { title: "T" }, why: "" });
    expect(patch.custom).toBeUndefined();
  });
});

describe("small helpers", () => {
  test("aspect ratio follows the video and is vertical when unknown", () => {
    expect(aspectOf(null)).toBeCloseTo(9 / 16);
    expect(aspectOf({ width: 1920, height: 1080 })).toBeCloseTo(16 / 9);
    expect(aspectOf({ width: 1080, height: 1080 })).toBe(1);
    expect(aspectOf({ width: 100, height: 1000 })).toBeCloseTo(9 / 16);
  });
  test("hashtags are normalised: one #, no repeats, single spaces", () => {
    expect(normalizeTags("morning ##Routine, #morning  habits")).toBe("#morning #Routine #habits");
    expect(normalizeTags("")).toBe("");
    expect(countHashtags("#a #b text #c")).toBe(3);
  });
  test("arrow keys move between cards and wrap", () => {
    expect(nextIndex("ArrowRight", 2, 3)).toBe(0);
    expect(nextIndex("ArrowLeft", 0, 3)).toBe(2);
    expect(nextIndex("Home", 2, 3)).toBe(0);
    expect(nextIndex("End", 0, 3)).toBe(2);
    expect(nextIndex("a", 0, 3)).toBe(-1);
  });
  test("bodyKey: YouTube writes to the description", () => {
    expect(bodyKey("youtube")).toBe("description");
    for (const p of PLATFORMS.filter((x) => x !== "youtube")) expect(bodyKey(p)).toBe("caption");
  });
});

describe("checks next to the field", () => {
  test("every check names its field and LinkedIn titles are held to 200", () => {
    const yt = checksFor("youtube", draft({ title: "" }), null);
    expect(yt.find((c) => c.text.startsWith("Add a title"))?.field).toBe("title");
    const over = checksFor("youtube", draft({ title: "a".repeat(103), description: "d" }), null);
    expect(over.find((c) => c.field === "title")?.text).toBe("Title is 3 characters over.");
    expect(checksFor("linkedin", draft({ caption: "c", title: "a".repeat(201) }), null).some((c) => c.field === "title" && c.level === "error")).toBe(true);
    expect(checksFor("linkedin", draft({ caption: "c", title: "" }), null).some((c) => c.level === "error")).toBe(false);
    expect(checksFor("x", draft({ caption: "" }), null)[0].field).toBe("body");
    expect(checksFor("instagram", draft({ caption: "c" }), { duration: 9999 }).find((c) => c.level === "error")?.field).toBe("media");
  });
  test("real hashtag rules: Instagram over 30 is blocked, YouTube over 15 is a heads up", () => {
    const tags = (n: number) => Array.from({ length: n }, (_, i) => `#t${i}`).join(" ");
    expect(checksFor("instagram", draft({ caption: "c", hashtags: tags(30) }), null).some((c) => c.field === "hashtags")).toBe(false);
    expect(checksFor("instagram", draft({ caption: "c", hashtags: tags(31) }), null).find((c) => c.field === "hashtags")?.level).toBe("error");
    expect(checksFor("youtube", draft({ title: "t", description: "d", hashtags: tags(16) }), null).find((c) => c.field === "hashtags")?.level).toBe("warning");
    expect(checksFor("tiktok", draft({ caption: "c", hashtags: tags(40) }), null).some((c) => c.field === "hashtags")).toBe(false);
    expect(PLATFORM_META.x.hashtagStyle).toBe("none");
  });
});
