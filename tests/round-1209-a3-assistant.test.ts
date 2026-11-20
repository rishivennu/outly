/**
 * R1209 A3: the Outlly Assistant follows the step and the caption mode, never duplicates an editor or an Accept
 * that is already on the page, can grow wider on a desktop or fill a phone, and never sits under the phone keyboard.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { stepLine } from "../components/create/assistant-state";
import { REFINE_ASKS, STORY_MODE_ASKS } from "../lib/ai/pip-asks";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("R1209 A3: the assistant says what this step and mode are about", () => {
  test("Write my own: the line is about the creator's words", () => {
    expect(stepLine({ step: "story", mode: "own", hasCaption: false, watching: false })?.title).toBe("Your words, sharpened.");
    expect(stepLine({ step: "story", mode: "own", hasCaption: false, watching: false })?.body).toContain("Write your caption on the page");
    expect(stepLine({ step: "story", mode: "own", hasCaption: true, watching: false })?.body).toContain("Rephrase");
  });
  test("Generate with Outlly: writing, then written", () => {
    expect(stepLine({ step: "story", mode: "generate", hasCaption: false, watching: true })?.title).toBe("Writing from your video.");
    expect(stepLine({ step: "story", mode: "generate", hasCaption: true, watching: false })?.title).toBe("Written from your video.");
    expect(stepLine({ step: "story", mode: "generate", hasCaption: false, watching: false })?.body).toContain("Generate caption");
  });
  test("Everywhere names the platform and its limit, or asks for a card", () => {
    const l = stepLine({ step: "everywhere", mode: "generate", hasCaption: true, watching: false, place: "Instagram", limit: 2200 });
    expect(l?.title).toBe("Working on Instagram.");
    expect(l?.body).toContain("Up to 2,200 characters there.");
    expect(stepLine({ step: "everywhere", mode: "own", hasCaption: true, watching: false, place: "Threads" })?.body).not.toContain("characters");
    expect(stepLine({ step: "everywhere", mode: "own", hasCaption: true, watching: false })?.title).toBe("Now each platform.");
  });
  test("Launch and Your Video carry no step line", () => {
    expect(stepLine({ step: "launch", mode: "own", hasCaption: true, watching: false })).toBeNull();
    expect(stepLine({ step: "video", mode: "generate", hasCaption: false, watching: false })).toBeNull();
  });
  test("no step line uses a dash", () => {
    for (const mode of ["own", "generate"] as const)
      for (const hasCaption of [true, false])
        for (const watching of [true, false]) {
          const l = stepLine({ step: "story", mode, hasCaption, watching });
          expect(`${l?.title} ${l?.body}`).not.toMatch(/[\u2013\u2014]/);
        }
  });
});

describe("R1209 A3: one place for each action", () => {
  test("Generate mode: Pip never repeats a Refine chip that is on the page", () => {
    const page = new Set(REFINE_ASKS.map((a) => a.id));
    expect(STORY_MODE_ASKS.generate.filter((a) => page.has(a.id as never))).toEqual([]);
    expect(STORY_MODE_ASKS.generate.map((a) => a.id)).toContain("voice");
  });
  test("Write my own: Pip never offers Rephrase, the page's own button", () => {
    expect(STORY_MODE_ASKS.own.map((a) => a.id)).not.toContain("rephrase");
    expect(STORY_MODE_ASKS.own.map((a) => a.id)).toContain("hook");
  });
  test("PipActions has no Accept of its own and no second suggestion list", () => {
    const s = src("components/create/PipActions.tsx");
    expect(s).toContain("STORY_MODE_ASKS[p.mode ?? \"own\"]");
    expect(s).not.toContain("Suggestions waiting");
    expect(s).not.toContain("onAccept");
    expect(s).not.toContain("onReject");
    expect(s).toContain("The suggestion is waiting under Your caption.");
  });
  test("the assistant has no caption editor, no hooks cards and no finalize of its own", () => {
    const s = src("components/create/Assistant.tsx");
    expect(s).not.toContain("<textarea");
    expect(s).not.toContain("Textarea");
    expect(s).not.toContain("What's this video about?");
    expect(s).not.toContain("Suggested");
    expect(s).not.toContain("ConfirmDialog");
    expect(s).toContain("canFinalize: false");
    expect(s).toContain('footer.id !== "finalize" && p.onFooter?.(footer.id)');
    expect(s).toContain("data-pip-line");
  });
  test("the workspace no longer fetches hooks or submits text from Pip", () => {
    const s = src("components/create/CreateWorkspace.tsx");
    for (const gone of ["fetchHooks", "submitText", "submitStory", "chooseHook", "finalizeCaption", "tryAnother"]) expect(s).not.toContain(gone);
    expect(s).toContain("captionMode={storyMeta.mode}");
    expect(s).toContain("mode: storyMeta.mode");
    expect(s).toContain("const askPip = async (pl: Platform, ask: PipAsk)");
  });
});

describe("R1209 A3: size and the phone keyboard", () => {
  test("the expand button names what it does and says its state", () => {
    const s = src("components/create/Assistant.tsx");
    expect(s).toContain('aria-label={p.expanded ? "Make the assistant smaller" : "Expand the assistant"}');
    expect(s).toContain('data-pip-expand={p.expanded ? "on" : "off"}');
  });
  test("desktop width is 320 to 340, 440 to 480 when expanded; a phone gets the full screen", () => {
    const s = src("components/create/CreateWorkspace.tsx");
    expect(s).toContain('pipBig ? "xl:w-[440px] xl:opacity-100 2xl:w-[480px]" : "xl:w-[320px] xl:opacity-100 2xl:w-[340px]"');
    expect(s).toContain("max-xl:h-dvh");
    expect(s).toContain("max-xl:pt-[var(--sa-t)]");
    expect(s).toContain('data-pip-size={pipBig ? "big" : "normal"}');
  });
  test("the sheet rises above the phone keyboard", () => {
    const s = src("components/create/CreateWorkspace.tsx");
    expect(s).toContain("window.visualViewport");
    expect(s).toContain("window.innerHeight - vv.height - vv.offsetTop");
    expect(s).toContain('vv.removeEventListener("resize", f)');
    expect(s).toContain("paddingBottom: kbInset");
  });
});

describe("R1209 A3: platform answers know the platform's limit", () => {
  test("askPlatformCopy tells the model the character limit", () => {
    const s = src("lib/ai/creative.ts");
    expect(s).toContain("Limit: ${PLATFORM_META[platform].name} allows ${PLATFORM_META[platform].captionLimit} characters");
  });
});
