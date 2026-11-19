/**
 * R1209 A2 review fixes. Pip's footer on Your Story waits for the caption on the page, not a hook; the Step 3
 * entry write waits for another ask to finish instead of spending its one try; no copy points at the removed
 * Publish to section; tidying hashtags never takes an approval back.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Draft } from "../lib/client/checks";
import { pipFooter } from "../components/create/assistant-state";
import { withEditState } from "../components/create/review-state";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const draft = (o: Partial<Draft> = {}): Draft => ({ enabled: true, title: "", caption: "", description: "", hashtags: "", firstComment: "", note: "", reviewed: false, ...o });

describe("R1209 A2: Pip's footer on Your Story", () => {
  test("a written caption with no hook continues to Everywhere", () => {
    const f = pipFooter({ step: "story", storyOpen: true, finalized: true, canFinalize: false, composer: true });
    expect(f).toEqual({ id: "everywhere", label: "Continue to Everywhere", disabled: false, hint: null });
  });
  test("no caption yet keeps it disabled with the page hint", () => {
    const f = pipFooter({ step: "story", storyOpen: true, finalized: false, canFinalize: false, composer: true });
    expect(f.disabled).toBe(true);
    expect(f.hint).toContain("Write your caption on the page first.");
  });
  test("the composer gate is the caption, wired from CreateWorkspace", () => {
    expect(src("components/create/Assistant.tsx")).toContain("finalized: !!p.hasCaption, canFinalize: false, composer: p.hasMedia");
    expect(src("components/create/CreateWorkspace.tsx")).toContain("hasCaption={!!caption}");
    expect(src("components/create/assistant-state.ts")).not.toContain("then pick a hook");
  });
});

describe("R1209 A2: the Step 3 entry write", () => {
  const ws = src("components/create/CreateWorkspace.tsx");
  const effect = ws.slice(ws.indexOf("const adaptTried = useRef"), ws.indexOf("const onDraft = "));
  test("waits while another ask runs, before the try is spent", () => {
    const gate = effect.indexOf("|| asking || captionAsk) return;");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(effect.indexOf("adaptTried.current = key"));
  });
  test("re-runs when that ask ends", () => {
    expect(effect).toContain("[step, phase, caption, online, adapting, placesKey, asking, captionAsk]");
  });
});

describe("R1209 A2: copy and tags", () => {
  test("nothing points at the removed Publish to section", () => {
    expect(src("components/create/ActionBar.tsx")).not.toContain("Publish to.");
    expect(src("components/create/ActionBar.tsx")).toContain("Switch a platform on in Everywhere.");
  });
  test("step hints match the new steps", () => {
    const t = src("components/create/types.ts");
    expect(t).not.toContain("Find the hook");
    expect(t).toContain('hint: "Write your caption"');
    expect(t).toContain('hint: "Approve each caption"');
  });
  test("tidying tags keeps an approval", () => {
    expect(src("components/create/PlatformDeck.tsx")).toContain("set({ hashtags: clean, reviewed: !!d.reviewed })");
    const d = draft({ caption: "Hi", hashtags: "a b", reviewed: true });
    expect(withEditState(d, { hashtags: "#a #b", reviewed: true })).toEqual({ hashtags: "#a #b", reviewed: true });
  });
});
