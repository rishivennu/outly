/** Platform choice and explicit drafts (10-15 round): only chosen destinations publish, and a draft always gets saved. */
import { describe, expect, test } from "bun:test";
import { autosaveLine, canLaunch, draftTitle, enabledPlatforms, launchGate, targetPayload } from "../components/create/publish";
import { keepPlatforms, removedPlatforms } from "../app/api/posts/targets";
import { PLATFORMS, type Platform } from "../lib/domain";
import type { Draft } from "../lib/client/checks";
import { filterFromParam } from "../components/content/ContentLibrary";

const draft = (over: Partial<Draft> = {}): Draft => ({ enabled: false, title: "", caption: "", description: "", hashtags: "", note: "", reviewed: false, ...over });
const drafts = (over: Partial<Record<Platform, Partial<Draft>>>) =>
  Object.fromEntries(PLATFORMS.map((p) => [p, draft(over[p])])) as Record<Platform, Draft>;
const good = (extra: Partial<Draft> = {}) => ({ enabled: true, reviewed: true, caption: "A caption that reads well.", ...extra });
const connected = Object.fromEntries(PLATFORMS.map((p) => [p, { status: "connected" }])) as Record<Platform, { status: string }>;
const media = { duration: 30, width: 1080, height: 1920 };

describe("a deselected platform is never published to", () => {
  test("only enabled platforms reach the payload", () => {
    const d = drafts({ instagram: good(), youtube: { ...good(), title: "T" }, x: { enabled: false, caption: "written but skipped" } });
    expect(enabledPlatforms(d)).toEqual(["instagram", "youtube"]);
    expect(targetPayload(d).map((t) => t.platform)).toEqual(["instagram", "youtube"]);
    expect(targetPayload(d).some((t) => t.caption === "written but skipped")).toBe(false);
  });
  test("the API keeps only what the client sent, and deletes the rest", () => {
    const keep = keepPlatforms([{ platform: "youtube" }, { platform: "instagram" }, { platform: "instagram" }]);
    expect(keep).toEqual(["instagram", "youtube"]);
    expect(removedPlatforms([{ platform: "instagram" }, { platform: "youtube" }, { platform: "x" }], keep)).toEqual(["x"]);
  });
  test("an unknown platform cannot sneak in", () => expect(keepPlatforms([{ platform: "myspace" }])).toEqual([]));
});

describe("the All set gate ignores skipped platforms", () => {
  test("a skipped platform with broken copy does not hold up the launch", () => {
    const d = drafts({ instagram: good(), x: { enabled: false, caption: "" } });
    expect(launchGate(d, connected, media)).toMatchObject({ enabled: ["instagram"], pending: [], ready: true });
  });
  test("an enabled platform that still needs a look blocks it", () => {
    const d = drafts({ instagram: good(), youtube: { enabled: true, reviewed: false, title: "T", description: "D" } });
    expect(launchGate(d, connected, media).pending).toEqual(["youtube"]);
    expect(launchGate(d, connected, media).ready).toBe(false);
  });
  test("an enabled platform with no account blocks it, so the connect prompt stays the way through", () => {
    const d = drafts({ instagram: good() });
    expect(launchGate(d, {}, media).ready).toBe(false);
    expect(launchGate(d, { instagram: { status: "expired" } }, media).pending).toEqual(["instagram"]);
  });
  test("zero platforms is never launchable", () => {
    const none = drafts({});
    expect(canLaunch(none)).toBe(false);
    expect(launchGate(none, connected, media).ready).toBe(false);
    expect(canLaunch(drafts({ x: { enabled: true } }))).toBe(true);
  });
});

describe("a draft always gets a name", () => {
  test("the YouTube title wins, without the Shorts tag", () => {
    expect(draftTitle({ drafts: drafts({ youtube: { enabled: true, title: "Why we rebuilt it #Shorts" } }), hook: "a hook" })).toBe("Why we rebuilt it");
  });
  test("a skipped YouTube title is not used", () => {
    expect(draftTitle({ drafts: drafts({ youtube: { enabled: false, title: "Skipped title" } }), hook: "The hook\nsecond line" })).toBe("The hook");
  });
  test("no hook yet: the video filename, tidied", () => {
    expect(draftTitle({ drafts: drafts({}), hook: null, filename: "launch_day-cut.mp4" })).toBe("launch day cut");
  });
  test("nothing at all still makes a findable draft", () => {
    expect(draftTitle({ drafts: drafts({}), hook: null })).toBe("Untitled draft");
    expect(draftTitle({ drafts: drafts({}), hook: "   ", filename: "   " })).toBe("Untitled draft");
  });
  test("titles stay inside the 200 character column", () => {
    expect(draftTitle({ drafts: drafts({}), hook: "x".repeat(400) }).length).toBe(200);
  });
});

describe("the autosave line", () => {
  test("reads the state back in plain words", () => {
    expect(autosaveLine("idle", null)).toBe("Not saved yet");
    expect(autosaveLine("saving", null)).toBe("Saving…");
    expect(autosaveLine("saved", "12:04")).toBe("Draft saved 12:04");
    expect(autosaveLine("error", "12:04")).toBe("Couldn't save");
  });
  test("a known save time survives a later idle render", () => expect(autosaveLine("idle", "12:04")).toBe("Draft saved 12:04"));
});

describe("/content?filter= opens the right tab", () => {
  test("a known filter is honoured", () => {
    for (const f of ["draft", "scheduled", "published", "failed", "all"]) expect(filterFromParam(f)).toBe(f);
  });
  test("anything else falls back to all", () => {
    expect(filterFromParam("nonsense")).toBe("all");
    expect(filterFromParam(null)).toBe("all");
    expect(filterFromParam(undefined)).toBe("all");
  });
});
