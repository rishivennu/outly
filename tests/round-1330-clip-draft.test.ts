/**
 * R1330: a Create draft whose video is already on Outlly (a Clipper render arrives as an owned Media with no file in
 * the tab; a finished upload has one but needs no second trip) remembers that Media and the clip it came from on the
 * device, so a reload adopts the server copy and the first save still links the clip. Before this, writeLocal saved
 * words only and a clip draft came back as "add the video again" with the clip link gone.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { installFakeIndexedDb } from "./helpers/fake-indexeddb";

installFakeIndexedDb();

let dd: typeof import("../lib/client/device-drafts");
beforeAll(async () => {
  dd = await import("../lib/client/device-drafts");
});

const words = (id: string, extra: Record<string, unknown> = {}) => ({ id, postId: null, title: `T ${id}`, story: "s", hook: null, targets: { instagram: { enabled: true, title: "", caption: "c", description: "", hashtags: "", firstComment: "" } }, filename: "clip.mp4", poster: null, ...extra });

describe("1330 the device copy keeps the server video and the clip", () => {
  test("mediaId and clipId are written, kept across a save that does not mention them, and cleared by null", async () => {
    const s = dd.openDrafts("user-1330");
    expect(await s.save(words("d1", { mediaId: "m_1", clipId: "clip_1" }))).toBe(true);
    let d = await s.get("d1");
    expect(d?.draft.mediaId).toBe("m_1");
    expect(d?.draft.clipId).toBe("clip_1");
    expect(d?.video).toBe(null);

    // A caption-only write (no mediaId/clipId keys at all) must not forget the video.
    expect(await s.save(words("d1", { story: "edited" }))).toBe(true);
    d = await s.get("d1");
    expect(d?.draft.story).toBe("edited");
    expect(d?.draft.mediaId).toBe("m_1");
    expect(d?.draft.clipId).toBe("clip_1");

    // A different file took over: the workspace says so explicitly.
    expect(await s.save(words("d1", { mediaId: null, clipId: null }))).toBe(true);
    d = await s.get("d1");
    expect(d?.draft.mediaId).toBe(null);
    expect(d?.draft.clipId).toBe(null);
  });

  test("only strings reach the disk", async () => {
    const s = dd.openDrafts("user-1330b");
    expect(await s.save(words("d2", { mediaId: { id: "m" }, clipId: 42 }))).toBe(true);
    const d = await s.get("d2");
    expect(d?.draft.mediaId).toBe(null);
    expect(d?.draft.clipId).toBe(null);
  });

  test("older records without the fields read back unchanged", async () => {
    const s = dd.openDrafts("user-1330c");
    expect(await s.save(words("d3"))).toBe(true);
    const d = await s.get("d3");
    expect("mediaId" in (d?.draft ?? {})).toBe(false);
    expect("clipId" in (d?.draft ?? {})).toBe(false);
  });
});

describe("1330 CreateWorkspace wiring (source pins)", () => {
  const src = readFileSync("components/create/CreateWorkspace.tsx", "utf8");
  const store = readFileSync("lib/client/device-drafts.ts", "utf8");

  test("the record type carries both fields", () => {
    expect(store).toMatch(/mediaId\?: string \| null;/);
    expect(store).toMatch(/clipId\?: string \| null;/);
  });

  test("writeLocal saves the Media only once the server has it, and the clip from recOrigin", () => {
    expect(src).toMatch(/const mediaId = media && upload\.kind === "done" \? media\.id : null;/);
    expect(src).toMatch(/const clipId = recOrigin\.current\?\.clipId \?\? null;/);
    expect(src).toMatch(/baseUpdatedAt: baseRef\.current \?\? undefined, schedule, mediaId, clipId \}, fileRef\.current\)/);
    // The debounce re-runs when the upload finishes, not only when words change.
    expect(src).toMatch(/\[deviceReady, phase, hasMedia, postId, drafts, hook, story, metaJson, media, upload\.kind, localPoster, mode, when\]/);
  });

  test("restore asks the server for the Media before falling back to the file, and puts the clip back on the first save", () => {
    const restore = src.indexOf("const onOutlly = d.mediaId ? await api<{ media: MediaView }>(`/api/media/${encodeURIComponent(d.mediaId)}`)");
    const file = src.indexOf("} else if (found.video) {");
    expect(restore).toBeGreaterThan(0);
    expect(file).toBeGreaterThan(restore);
    const block = src.slice(restore, file);
    expect(block).toContain("synced.current = onOutlly.id;");
    expect(block).toContain("setMedia(onOutlly);");
    expect(block).toContain('setUpload({ kind: "done" });');
    expect(block).toContain("if (d.clipId) recOrigin.current = { ...(recOrigin.current ?? {}), clipId: d.clipId };");
    // No "Uploading the video again" when nothing is uploaded.
    expect(block).toContain('"Picked up where you left off."');
  });

  test("a new file still drops the clip link (R1323 review) and the next local write records that", () => {
    expect(src).toMatch(/if \(recOrigin\.current\?\.clipId\) recOrigin\.current = recOrigin\.current\.recommendationId \|\| recOrigin\.current\.adaptedFromPostId \? \{ \.\.\.recOrigin\.current, clipId: undefined \} : null;/);
  });
});
