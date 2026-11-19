/**
 * R1209 A1: Your Story asks one question, "who writes my caption, Outlly or me?". Generate with Outlly shows the
 * caption written from the video already read, editable, refinable and recoverable; Write my own is one box with a
 * Rephrase that only ever suggests. Both boxes, the mode and Outlly's untouched caption are saved with the draft.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { acceptRewrite, captionKey, emptyMeta, META_MAX, parseMeta, serializeMeta, startMeta, staleFor, switchMode, takeGenerated, withCaption } from "../components/create/story-meta";
import { CAPTION_ASK_LABEL, CAPTION_ASK_RULE, CAPTION_ASKS, REFINE_ASKS, ASK_KEYS } from "../lib/ai/pip-asks";
import { ADAPT_MAX } from "../lib/ai/adapt-core";
import { captionAskRequestSchema, savePostSchema, updatePostSchema } from "../lib/validation";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("R1209 A1: a draft starts in the right mode", () => {
  test("a new draft starts with Outlly writing; one with words already is the creator's own", () => {
    expect(startMeta(null, "")).toEqual(emptyMeta("generate"));
    expect(startMeta(undefined, null).mode).toBe("generate");
    const own = startMeta(null, "My morning, fixed.");
    expect(own.mode).toBe("own");
    expect(own.own).toBe("My morning, fixed.");
  });
  test("a saved meta comes back as it was; anything unreadable starts fresh", () => {
    const m = { ...emptyMeta("own"), own: "mine", generated: "outlly", original: "outlly", seen: "a kitchen", from: { tiktok: captionKey("mine") } };
    expect(startMeta(JSON.stringify(m), "mine")).toEqual(m);
    expect(parseMeta("{not json")).toBeNull();
    expect(parseMeta("[]")).toBeNull();
    expect(parseMeta("")).toBeNull();
    // a bad platform key or a key that isn't one is dropped, never trusted
    const p = parseMeta(JSON.stringify({ mode: "own", from: { tiktok: "abc", nope: "abc", youtube: "<script>" } }));
    expect(p?.from).toEqual({ tiktok: "abc" });
    expect(parseMeta(JSON.stringify({ mode: "weird" }))?.mode).toBe("generate");
  });
});

describe("R1209 A1: switching modes keeps both boxes", () => {
  test("each mode's words come back as they were left", () => {
    let m = { ...emptyMeta("generate"), original: "Outlly wrote this.", generated: "Outlly wrote this." };
    let caption = "Outlly wrote this, edited.";
    const a = switchMode(m, caption, "own");
    expect(a.caption).toBe("");
    expect(a.meta.generated).toBe("Outlly wrote this, edited.");
    m = a.meta;
    caption = "My own words.";
    const b = switchMode(m, caption, "generate");
    expect(b.caption).toBe("Outlly wrote this, edited.");
    expect(b.meta.own).toBe("My own words.");
    expect(b.meta.mode).toBe("generate");
    // the same mode again changes nothing
    expect(switchMode(b.meta, b.caption, "generate")).toEqual({ meta: b.meta, caption: b.caption });
  });
  test("the open box is saved from the caption itself", () => {
    expect(withCaption(emptyMeta("own"), "typed").own).toBe("typed");
    expect(withCaption(emptyMeta("generate"), "typed").generated).toBe("typed");
    expect(JSON.parse(serializeMeta(emptyMeta("own"), "typed")).own).toBe("typed");
  });
});

describe("R1209 A1: Outlly's caption from the video", () => {
  test("lands in an empty Generate box, and is kept as the original", () => {
    const r = takeGenerated(emptyMeta("generate"), "", "  From the video.  ", "a kitchen at dawn");
    expect(r).toMatchObject({ caption: "From the video.", offer: false });
    expect(r.meta.original).toBe("From the video.");
    expect(r.meta.generated).toBe("From the video.");
    expect(r.meta.seen).toBe("a kitchen at dawn");
  });
  test("replaces its own untouched caption, but is only offered over words the creator edited", () => {
    const m = { ...emptyMeta("generate"), original: "Old one.", generated: "Old one." };
    expect(takeGenerated(m, "Old one.", "New one.").caption).toBe("New one.");
    const edited = takeGenerated(m, "Old one, my edit.", "New one.");
    expect(edited.offer).toBe(true);
    expect(edited.caption).toBe("Old one, my edit.");
    expect(edited.meta.original).toBe("New one.");
  });
  test("while the creator writes their own, it waits in the Generate box and never touches theirs", () => {
    const r = takeGenerated({ ...emptyMeta("own") }, "My words.", "From the video.");
    expect(r.caption).toBe("My words.");
    expect(r.offer).toBe(false);
    expect(r.meta.generated).toBe("From the video.");
    expect(switchMode(r.meta, r.caption, "generate").caption).toBe("From the video.");
  });
  test("what Outlly saw is kept unless a new watch saw something", () => {
    const m = { ...emptyMeta("generate"), seen: "first look" };
    expect(takeGenerated(m, "", "x", "  ").meta.seen).toBe("first look");
    expect(takeGenerated(m, "", "x", "y".repeat(5000)).meta.seen.length).toBe(1000);
  });
});

describe("R1209 A1: an accepted rewrite is one tap from undone", () => {
  test("the words before it are kept", () => {
    const m = acceptRewrite(emptyMeta("own"), "Mine.", "Sharper mine.");
    expect(m.before).toBe("Mine.");
    expect(m.accepted).toBe("Sharper mine.");
  });
});

describe("R1209 A1: saved under the server's cap", () => {
  test("history goes first, both boxes always fit", () => {
    const big = "x".repeat(ADAPT_MAX);
    const m = { ...emptyMeta("own"), generated: big, original: big, before: big, accepted: big, seen: "s".repeat(1000) };
    const s = serializeMeta(m, big);
    expect(s.length).toBeLessThanOrEqual(META_MAX);
    const back = parseMeta(s)!;
    expect(back.own).toBe(big);
    expect(back.generated).toBe(big);
    expect(back.accepted).toBe("");
  });
  test("the save requests take it, up to the cap", () => {
    const base = { mediaId: "ckxxxxxxxxxxxxxxxxxxxxxxx", targets: [] };
    expect(savePostSchema.safeParse({ ...base, storyMeta: "{}" }).success).toBe(true);
    expect(savePostSchema.safeParse({ ...base, storyMeta: "x".repeat(META_MAX + 1) }).success).toBe(false);
    expect(updatePostSchema.safeParse({ storyMeta: "{}" }).success).toBe(true);
  });
});

describe("R1209 A1: Step 3 writes only the places on an older caption", () => {
  test("a place written from this caption keeps its words", () => {
    const k = captionKey("Same caption.");
    expect(captionKey("  Same caption. ")).toBe(k);
    expect(staleFor({ tiktok: k, youtube: captionKey("old") }, ["tiktok", "youtube", "instagram"], "Same caption.", () => false)).toEqual(["youtube"]);
    expect(staleFor({}, ["tiktok"], "Same caption.", () => true)).toEqual(["tiktok"]);
  });
});

describe("R1209 A1: the asks", () => {
  test("six optional refinements on Outlly's caption, and Rephrase on the creator's own", () => {
    expect(REFINE_ASKS.map((a) => a.label)).toEqual(["Make it more engaging", "Create a stronger hook", "Make it shorter", "Improve the CTA", "Make it conversational", "Make it professional"]);
    for (const a of REFINE_ASKS) expect(CAPTION_ASKS).toContain(a.id);
    expect(CAPTION_ASKS).toContain("rephrase");
    expect(CAPTION_ASK_RULE.rephrase).toMatch(/meaning/i);
    expect(CAPTION_ASK_RULE.rephrase).toMatch(/claim|invent|add/i);
    for (const a of CAPTION_ASKS) expect(CAPTION_ASK_LABEL[a].length).toBeGreaterThan(3);
    expect(ASK_KEYS.rephrase).toEqual(["title", "caption", "description"]);
  });
  test("a refinement may carry what was seen in the video, never a second watch", () => {
    expect(captionAskRequestSchema.parse({ text: "My morning, fixed.", ask: "rephrase", seen: "a kitchen" })).toEqual({ text: "My morning, fixed.", ask: "rephrase", seen: "a kitchen" });
    expect(captionAskRequestSchema.safeParse({ text: "My morning, fixed.", ask: "hook", seen: "x".repeat(1501) }).success).toBe(false);
    const r = src("app/api/ai/caption/route.ts");
    expect(r).toContain("const { text, ask, seen } = captionAskRequestSchema.parse(await req.json());");
    const ad = src("lib/ai/adapt.ts");
    expect(ad).toContain("What the video shows (for context only, add nothing that isn't in it or the caption)");
  });
});

describe("R1209 A1: the page", () => {
  const c = src("components/create/StoryComposer.tsx");
  const w = src("components/create/CreateWorkspace.tsx");
  test("one tab list, one box, only the picked way shows", () => {
    expect(c).toContain('role="tablist" aria-label="Who writes your caption"');
    expect(c.match(/<Textarea/g)?.length).toBe(1);
    for (const s of ["Use this caption", "Edit caption", "Regenerate caption", "Restore original", "Refine it, if you like", "Rephrase with Outlly Assistant", "Accept suggestion", "Edit suggestion", "Keep original"]) expect(c).toContain(s);
    // no dashes in the copy, no transition-all
    expect(c).not.toMatch(/[\u2013\u2014]/);
    expect(c).not.toContain("transition-all");
  });
  test("the video is read once: a retry, a captioned copy or a restored draft never reads it again", () => {
    expect(w).toContain("const look = o?.watch ?? (!same && submittedRef.current === null && !metaRef.current.original);");
    expect(w).toContain("startUpload(found.video, undefined, undefined, { watch: !d.story?.trim() && !sm.original });");
    expect(w).toContain("const r = takeGenerated(metaRef.current, story, text, seenText);");
  });
  test("the meta is saved with the draft, on Outlly and on the device", () => {
    expect(w.match(/storyMeta: metaJson/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(src("app/api/posts/route.ts").match(/storyMeta: body\.storyMeta/g)?.length).toBe(2);
    expect(src("lib/services.ts")).toContain("storyMeta: p.storyMeta ?? null,");
    expect(src("lib/client/device-drafts.ts")).toContain("storyMeta?: string;");
    expect(src("prisma/schema.prisma")).toMatch(/storyMeta\s+String\?/);
    expect(src("prisma/schema.template.prisma")).toMatch(/storyMeta\s+String\?/);
  });
});
