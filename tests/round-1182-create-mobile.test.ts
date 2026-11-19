/** 1182: mobile Create. Pip opens itself on Steps 1 and 2, folds once the caption is final, and always has a way forward besides the X; the deck keeps connected accounts as cards and folds the rest into compact rows. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { barState, type BarInput } from "../components/create/ActionBar";
import { captionFinal, captionTips, hookNote, panelReducer, PANEL_OPEN, pipFooter, pipOpensOn, type CaptionFacts } from "../components/create/assistant-state";
import type { Step } from "../components/create/types";

const src = (f: string) => readFileSync(f, "utf8");
const ws = src("components/create/CreateWorkspace.tsx");
const pip = src("components/create/Assistant.tsx");
const deck = src("components/create/PlatformDeck.tsx");
const bar = src("components/create/ActionBar.tsx");
const facts = (f: Partial<CaptionFacts> = {}): CaptionFacts => ({ lines: 0, busy: null, failed: false, gaps: 0, spoken: "", english: false, ai: true, ...f });

describe("1182 Pip opens on Steps 1 and 2 until the caption is final", () => {
  test("Your Video opens it until the caption is final; Your Story always does", () => {
    const steps: Step[] = ["video", "story", "everywhere", "launch"];
    expect(steps.filter((s) => pipOpensOn(s, false))).toEqual(["video", "story"]);
    // R1198: Your Story always opens it, since its asks work on the captions written there.
    expect(steps.filter((s) => pipOpensOn(s, true))).toEqual(["story"]);
  });
  test("a caption is final once a real hook is picked; spaces are not a hook", () => {
    expect(captionFinal("Five years in one minute")).toBe(true);
    expect(captionFinal("   ")).toBe(false);
    expect(captionFinal(null)).toBe(false);
  });
  test("the workspace opens it on entering a step, waits for a restored draft, and never writes that to this browser", () => {
    const fx = ws.slice(ws.indexOf("const pipStep = useRef<Step | null>(null);"), ws.indexOf("}, [step, phase, hook, deviceReady]);"));
    expect(fx).toContain('if (phase !== "edit") {');
    expect(fx).toContain("pipStep.current = null;");
    expect(fx).toContain("if (!deviceReady || pipStep.current === step) return;");
    expect(fx).toContain("if (!pipOpensOn(step, captionFinal(hook))) return;");
    expect(fx).toContain('panelDispatch({ t: "set", open: true })');
    expect(fx).toContain("setDrawer(true);");
    expect(fx).not.toContain("localStorage");
  });
  test("a step change on its own still leaves the side panel as it was", () => {
    const shut = panelReducer(PANEL_OPEN, { t: "set", open: false });
    expect(panelReducer(shut, { t: "step", step: "story" }).open).toBe(false);
  });
});

describe("1182 finalizing folds Pip, closing never finalizes", () => {
  test("R1209 A3: Pip has no Finalize of its own; the caption is final on the page (Use this caption)", () => {
    expect(ws).not.toContain("const finalizeCaption = async");
    expect(ws).not.toContain("onUse={finalizeCaption}");
    expect(src("components/create/StoryComposer.tsx")).toContain("Use this caption");
  });
  test("Close and the X only fold: no hook, no save, no send", () => {
    const at = ws.indexOf("const closePip = ");
    const close = ws.slice(at, ws.indexOf(";", at));
    expect(close).toContain("wide ? setPip(false) : closeDrawer()");
    expect(close).not.toMatch(/setHook|chooseHook|save\(|launch\(/);
    expect(ws).toContain("onClose={closePip}");
    expect(ws).toContain('aria-label="Close Pip"');
  });
  test("the footer buttons go through the page's own checks", () => {
    const fn = ws.slice(ws.indexOf("const onPipFooter = "), ws.indexOf("/* ================= render"));
    expect(fn).toContain('if (id === "story") return void (reachable.story && goTo("story"));');
    expect(fn).toContain('if (id === "everywhere" && !reachable.everywhere) return;');
    expect(fn).toContain('if (id === "done") return closePip();');
  });
  test("a folded Pip on a phone is a 48px floating button with a name, above the action bar", () => {
    expect(ws).toContain('aria-label="Open the Outlly assistant"');
    expect(ws).toMatch(/const pipFabButton = drawer \? null : \(\s*<Button ref=\{pipFab\}[^>]*className="h-12 w-12 rounded-full/);
    expect(ws).toContain("pip={pipFabButton}");
    expect(bar).toContain('{pip && <div className="absolute bottom-full right-1 mb-2.5 xl:hidden">{pip}</div>}');
    expect(bar).toContain('pip && "max-xl:mt-[70px]"');
  });
  test("focus comes back to the floating button when Pip opened by itself", () => {
    expect(ws).toContain("(drawerFrom.current?.isConnected ? drawerFrom.current : pipFab.current)?.focus?.()");
  });
});

describe("1182 the footer's lit button, by step", () => {
  const f = (step: Step, x: Partial<Parameters<typeof pipFooter>[0]> = {}) => pipFooter({ step, storyOpen: true, finalized: false, canFinalize: true, ...x });
  test("Step 1 continues to Your Story, off with the page's reason until the video is in", () => {
    expect(f("video")).toMatchObject({ id: "story", label: "Continue to Your Story", disabled: false });
    expect(f("video", { storyOpen: false, storyWhy: "Your video is still uploading. Your Story opens once it's in." })).toMatchObject({ disabled: true, hint: "Your video is still uploading. Your Story opens once it's in." });
  });
  test("Step 2 finalizes the caption, waits while writing, and moves on once final", () => {
    expect(f("story")).toMatchObject({ id: "finalize", label: "Finalize caption", disabled: false });
    expect(f("story", { busy: true }).disabled).toBe(true);
    expect(f("story", { canFinalize: false }).disabled).toBe(true);
    expect(f("story", { finalized: true, canFinalize: false })).toMatchObject({ id: "everywhere", label: "Continue to Everywhere", disabled: false });
  });
  test("Step 3 is Done, Step 4 goes back to editing", () => {
    expect(f("everywhere")).toMatchObject({ id: "done", label: "Done" });
    expect(f("launch")).toMatchObject({ id: "edit", label: "Back to editing" });
  });
  test("the panel has a header with name and status, and a footer with Close next to the lit button", () => {
    expect(pip).toContain(">Outlly Assistant</h2>");
    expect(pip).toContain('role="status">{status}</p>');
    expect(pip).toContain('<footer className="shrink-0 border-t');
    expect(pip).toMatch(/variant="ghost" className="min-h-11 shrink-0 px-3.5" onClick=\{p\.onClose\}>\s*Close/);
    expect(pip).toContain('onClick={() => footer.id !== "finalize" && p.onFooter?.(footer.id)}');
  });
  test("R1209 A3: no edit lives in Pip, so there is nothing to discard there", () => {
    expect(pip).not.toContain('title="Discard your edit?"');
  });
});

describe("1182 Pip's notes come from the real run", () => {
  test("nothing from Pip when AI captions are off", () => {
    expect(captionTips(facts({ ai: false }))).toEqual([]);
  });
  test("no lines yet: how to start, with the language choice", () => {
    const [t] = captionTips(facts());
    expect(t).toContain("Transcribe with AI");
    expect(t).toContain("Telugu");
  });
  test("busy, failed and gaps say what is going on", () => {
    expect(captionTips(facts({ busy: "transcribe" }))[0]).toContain("Transcribing");
    expect(captionTips(facts({ failed: true }))[0]).toContain("didn't finish");
    expect(captionTips(facts({ lines: 4, gaps: 2 }))).toContain("2 parts of the video came back without words. Retry them in the caption editor.");
  });
  test("translation is offered only for lines in another language", () => {
    expect(captionTips(facts({ lines: 5, spoken: "en" })).join(" ")).not.toContain("Translate");
    expect(captionTips(facts({ lines: 5, spoken: "te" })).join(" ")).toContain("Translate to English");
    expect(captionTips(facts({ lines: 5, spoken: "te", english: true })).join(" ")).toContain("Switch between Original and English");
  });
  test("the hook note counts words and nudges only a long one", () => {
    expect(hookNote("")).toBeNull();
    expect(hookNote("Five years in one minute")).toBe("5 words, short enough to read in one glance.");
    expect(hookNote(Array(20).fill("word").join(" "))).toContain("20 words. That's long");
  });
});

describe("1182 the deck: connected cards first, compact rows for the rest", () => {
  test("cards only for connected accounts; the rest are rows of 64 to 76px with a 36px icon and a quiet Connect", () => {
    expect(deck).toContain('const linked = live.filter((pl) => p.accounts[pl]?.status === "connected");');
    expect(deck).toContain("{linked.map((pl) => {");
    expect(deck).toContain("{off.map((pl) => {");
    expect(deck).toContain('className="flex min-h-16 max-h-[76px] min-w-0 items-center gap-3 rounded-2xl border border-border/60');
    expect(deck).toMatch(/off\.map[\s\S]*?<PlatformOrb platform=\{pl\} size=\{36\} \/>/);
    expect(deck).toMatch(/variant="ghost" data-connect="" className="h-11 shrink-0 rounded-full px-3 hairline" onClick=\{\(\) => p\.onConnect\(pl\)\}/);
  });
  test("the two groups are named, connected first, with a Connect more platforms shortcut", () => {
    expect(deck.indexOf(">Your platforms</h3>")).toBeGreaterThan(0);
    expect(deck.indexOf(">Connect more platforms</h3>")).toBeGreaterThan(deck.indexOf(">Your platforms</h3>"));
    expect(deck).toContain("Connect more platforms");
  });
  test("no Preview only pill or label is left", () => {
    expect(deck).not.toContain(">Preview only<");
    expect(deck).not.toContain('"Preview only"');
  });
  test("the editor is for a connected account only, folds on a second tap, and opens under the switcher", () => {
    expect(deck).toContain("const active = linked.includes(picked) ? picked : (linked[0] ?? picked);");
    expect(deck).toContain("onClick={() => (on ? setShut((v) => !v) : (setActive(pl), setShut(false)))}");
    expect(deck).toContain("aria-expanded={open}");
    expect(deck).not.toContain("narrow && open && editor");
    expect(deck).toContain("{!shut && editor}");
  });
  test("a place switched on from an older draft but not connected can be left out from its row", () => {
    expect(deck).toContain("onClick={() => p.onDraft(pl, { enabled: false })}");
  });
});

describe("1182 the action bar on phones", () => {
  const base: BarInput = { online: true, hasMedia: true, uploadFailed: false, hasCaption: true, ready: true, enabledCount: 2, launching: false, saving: false };
  test("Step 3: one lit Continue to Launch, Save draft and Preview beside it", () => {
    const s = barState({ ...base, step: "everywhere" });
    expect(s.buttons.filter((b) => b.primary).map((b) => b.label)).toEqual(["Continue to Launch"]);
    expect(s.buttons.map((b) => b.id)).toEqual(["save", "preview", "continue"]);
  });
  test("sits above the tab bar, 12px off the bottom in the app where Create has none, and fields scroll clear of it", () => {
    expect(bar).toContain("sticky bottom-[calc(env(safe-area-inset-bottom)+74px)]");
    expect(bar).toContain("[html[data-app]_&]:bottom-[calc(env(safe-area-inset-bottom)+12px)]");
    expect(bar).toContain("max-lg:[html:has(&)]:scroll-pb-[calc(env(safe-area-inset-bottom)+210px)]");
  });
  test("the phone sheet fits what it holds, up to 86dvh, with the safe area kept", () => {
    expect(ws).toContain("max-xl:flex max-xl:max-h-[min(86dvh,720px)] max-xl:w-full max-xl:flex-col");
    expect(ws).toContain("max-xl:pb-[env(safe-area-inset-bottom)]");
    expect(pip).toContain('<section aria-label="Creative partner" className="flex h-full min-h-0 flex-col">');
  });
  test("no dashes in the 1182 files", () => {
    for (const t of [ws, pip, deck, bar, src("components/create/assistant-state.ts")]) expect(t).not.toMatch(/[\u2013\u2014]/);
  });
});
