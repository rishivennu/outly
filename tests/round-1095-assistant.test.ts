import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { canSaveCaption, captionSource, PANEL_OPEN, panelReducer, type PanelState } from "@/components/create/assistant-state";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const assistant = src("components/create/Assistant.tsx");
const workspace = src("components/create/CreateWorkspace.tsx");

describe("1095 launch collapse", () => {
  // Phase 3 brief B1/B5 replaced the 1095 fold: Pip's conversation and panel stay put across every step,
  // so arriving at Launch changes nothing and only the creator's own toggle opens or closes it.
  test("arriving at Launch keeps the panel the way it was", () => {
    expect(panelReducer(PANEL_OPEN, { t: "step", step: "launch" })).toEqual(PANEL_OPEN);
    const closed: PanelState = { open: false, restore: null };
    expect(panelReducer(closed, { t: "step", step: "launch" })).toEqual(closed);
  });
  test("moving between steps never flips a hand-made choice", () => {
    let s = panelReducer(PANEL_OPEN, { t: "toggle" });
    for (const step of ["launch", "everywhere", "story", "launch"] as const) s = panelReducer(s, { t: "step", step });
    expect(s).toEqual({ open: false, restore: null });
  });
  test("a fold held by an older session is let go when the step changes", () => {
    const held: PanelState = { open: false, restore: true };
    expect(panelReducer(held, { t: "step", step: "everywhere" })).toEqual(PANEL_OPEN);
  });
  test("toggling flips the panel and clears anything held", () => {
    expect(panelReducer(PANEL_OPEN, { t: "toggle" })).toEqual({ open: false, restore: null });
    expect(panelReducer({ open: false, restore: true }, { t: "toggle" })).toEqual(PANEL_OPEN);
  });

  test("the panel is folded by width, not unmounted", () => {
    expect(workspace).toContain('id={ASSISTANT_PANEL}');
    // R1209 A3: a 320/340px side panel from 1280px (440/480px expanded); below that the same element is the drawer
    expect(workspace).toContain('panel.open ? (pipBig ? "xl:w-[440px] xl:opacity-100 2xl:w-[480px]" : "xl:w-[320px] xl:opacity-100 2xl:w-[340px]") : "xl:w-0 xl:opacity-0"');
    expect(workspace).toContain("const pipShown = wide ? panel.open : drawer;");
    expect(workspace).toContain("inert={!pipShown}");
    expect(workspace).toContain("aria-hidden={!pipShown}");
    // one Assistant element, placed in the aside whether it is open or closed
    expect(workspace).not.toContain("panel.open && <Assistant");
    expect(workspace).not.toContain("panel.open && assistant");
  });
  test("the toggle is reachable, labelled and wired to the panel", () => {
    expect(workspace).toContain("aria-expanded={panel.open}");
    expect(workspace).toContain("aria-controls={ASSISTANT_PANEL}");
    expect(workspace).toContain('aria-label={panel.open ? "Hide the Outlly assistant" : "Show the Outlly assistant"}');
    expect(workspace).toContain('size="icon"'); // h-11 w-11 = a 44px target
  });
  test("the workspace takes the freed width, smoothly and only when motion is welcome", () => {
    // 1170: one wide column on every step, wider still when Pip folds away.
    expect(workspace).toContain('pipShown ? "max-w-[1100px]" : "max-w-[1240px]"');
    expect(workspace).toContain("transition-[max-width]");
    expect(workspace).toContain("transition-[width,opacity]");
    // column width, Pip width, the upload tips chevron and (R1198) the phone's video preview chevron
    expect(workspace.match(/motion-reduce:transition-none/g)?.length).toBe(4);
  });
  test("the step drives it from one place", () => {
    expect(workspace).toContain('panelDispatch({ t: "step", step });');
    expect(workspace).toContain('useReducer(panelReducer, step, (s0: Step) => panelReducer(PANEL_OPEN, { t: "step", step: s0 }))');
  });
  test("a post that opens on Launch starts with the panel open, and the mount dispatch changes nothing", () => {
    const first = panelReducer(PANEL_OPEN, { t: "step", step: "launch" });
    expect(first.open).toBe(true);
    expect(panelReducer(first, { t: "step", step: "launch" })).toEqual(first);
  });
});

describe("1095 editing the original caption", () => {
  test("whitespace is not a caption", () => {
    expect(canSaveCaption("")).toBe(false);
    expect(canSaveCaption("   \n\t ")).toBe(false);
    expect(canSaveCaption(" a ")).toBe(true);
  });
  test("the edited original is what the writer works from", () => {
    expect(captionSource({ edited: "my own words", submittedStory: "what I said", story: "typing" })).toBe("my own words");
    expect(captionSource({ edited: null, submittedStory: "what I said", story: "typing" })).toBe("what I said");
    expect(captionSource({ edited: "   ", submittedStory: "what I said", story: "typing" })).toBe("what I said");
    expect(captionSource({ edited: null, submittedStory: null, story: "typing" })).toBe("typing");
  });

  test("both AI calls read the same source", () => {
    // R1209 A3: the platform copy and Pip's one-tap asks; Pip's hooks and the Original caption card are gone.
    expect(workspace.match(/captionSource\(\{ edited: editedOriginal, submittedStory, story \}\)/g)?.length).toBe(2);
    expect(workspace).not.toContain("{ story: submittedStory ?? story, hook: h, platforms }");
  });
  test("R1209 A3: the Original and Suggested cards are gone; the caption has one editing place, on the page", () => {
    for (const s of ['aria-label="Edit original caption"', "setCapEdit", "p.onOriginal", 'eyebrow !text-foreground">Suggested', "Try another", "Tweak it yourself"]) expect(assistant).not.toContain(s);
    expect(workspace).not.toContain("onOriginal={setEditedOriginal}");
  });
});
