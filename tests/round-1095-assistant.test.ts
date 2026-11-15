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
    // 1152: a 320/340px side panel from 1280px; below that the same element is the drawer
    expect(workspace).toContain('panel.open ? "xl:w-[300px] xl:opacity-100 2xl:w-[340px]" : "xl:w-0 xl:opacity-0"');
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
    expect(workspace).toContain('panel.open ? "lg:max-w-4xl" : "lg:max-w-5xl"');
    expect(workspace).toContain("transition-[max-width]");
    expect(workspace).toContain("transition-[width,opacity]");
    expect(workspace.match(/motion-reduce:transition-none/g)?.length).toBe(2);
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
    expect(workspace.match(/captionSource\(\{ edited: editedOriginal, submittedStory, story \}\)/g)?.length).toBe(2);
    expect(workspace).not.toContain("{ story: submittedStory ?? story, hook: h, platforms }");
    expect(workspace).toContain("original={editedOriginal ?? hooks.result?.original ?? \"\"}");
    expect(workspace).toContain("onOriginal={setEditedOriginal}");
  });
  test("a new story clears the old edit", () => {
    expect(workspace).toContain("setEditedOriginal(null); // a new story gets a new Original to read");
  });

  test("the Original card has a visible, labelled pencil", () => {
    expect(assistant).toContain('aria-label="Edit original caption"');
    expect(assistant).toContain('<Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit');
    expect(assistant).toContain("min-h-[44px]");
  });
  test("the editor saves, cancels and answers the keyboard", () => {
    expect(assistant).toContain('if (e.key === "Escape")');
    expect(assistant).toContain('e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSaveCaption(capEdit)');
    expect(assistant).toContain("disabled={!canSaveCaption(capEdit)}");
    expect(assistant).toContain("p.onOriginal(capEdit.trim());");
    expect(assistant).toContain("<Button variant=\"subtle\" onClick={() => setCapEdit(null)}>");
    expect(assistant).toContain("autoFocus");
  });
  test("lime is only on Save, and the card keeps its language", () => {
    const card = assistant.slice(assistant.indexOf('<p className="eyebrow">Original</p>'), assistant.indexOf('Suggested'));
    expect(card.match(/variant="lime"/g)?.length).toBe(1);
    expect(card).toContain("rounded-2xl");
    expect(card).toContain("hairline");
  });
  test("the suggested card and its wording are untouched", () => {
    expect(assistant).toContain('<p className="eyebrow !text-foreground">Suggested</p>');
    expect(assistant).toContain("Use this");
    expect(assistant).toContain("Try another");
    expect(assistant).toContain('aria-label={editing ? "Done editing" : "Tweak it yourself"}');
  });
  test("nothing changes before Save: the card reads the prop, the editor its own copy", () => {
    expect(assistant).toContain("const [capEdit, setCapEdit] = useState<string | null>(null);");
    expect(assistant).toContain("onClick={() => setCapEdit(p.original)}");
    expect(assistant).toContain("<p className=\"text-[15px] text-muted-foreground\">{p.original}</p>");
  });
});
