/**
 * Phase 3 B-shell: the one action bar, Launch that never sends a held place, Pip suggestions that are proposed
 * (accept, skip, revert) instead of written over the creator's words, music help per platform, and the layout.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { barState, type BarInput } from "../components/create/ActionBar";
import { confirmRows, launchGate, launchPlan, publishLabel, scheduleProblem } from "../components/create/publish";
import { isEmptyDraft, NO_SUGGESTIONS, PANEL_OPEN, panelReducer, routeCopy, suggest } from "../components/create/assistant-state";
import { deckLine, launchLine } from "../components/create/Assistant";
import { MUSIC_RULES, musicLines } from "../components/create/MusicNote";
import { emptyDraft, type Draft, type PlatformCopy } from "../components/create/types";
import { PLATFORM_META, PLATFORMS, type Platform } from "../lib/domain";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

const good = (x: Partial<Draft> = {}): Draft => ({ ...emptyDraft(true), title: "Stop forcing early mornings", caption: "Here's why", description: "How to build a routine", hashtags: "#routine", reviewed: true, ...x });
const drafts = (on: Partial<Record<Platform, Partial<Draft>>>) => {
  const out = {} as Record<Platform, Draft>;
  for (const p of PLATFORMS) out[p] = on[p] ? good(on[p]) : emptyDraft(false);
  return out;
};
const conn = (ps: Platform[], status = "connected") => Object.fromEntries(ps.map((p) => [p, { status, username: `me_${p}` }])) as Partial<Record<Platform, { status: string; username: string }>>;
const vertical = { duration: 30, width: 1080, height: 1920 };

const base: BarInput = { online: true, hasMedia: true, uploadFailed: false, hasHook: true, ready: true, enabledCount: 1, launching: false, saving: false };

describe("B4 one action bar", () => {
  test("Everywhere: Save draft, Preview, Continue to Launch, with Continue the only primary", () => {
    const s = barState({ ...base, step: "everywhere" });
    expect(s.buttons.map((b) => b.label)).toEqual(["Save draft", "Preview", "Continue to Launch"]);
    expect(s.buttons.filter((b) => b.primary).map((b) => b.id)).toEqual(["continue"]);
    expect(s.buttons.some((b) => b.id === "publish" || b.id === "schedule")).toBe(false);
  });
  test("Everywhere: Continue waits for every place to be looked over and says which", () => {
    const s = barState({ ...base, step: "everywhere", ready: false, pending: ["YouTube", "X"] });
    const c = s.buttons.find((b) => b.id === "continue")!;
    expect(c.disabled).toBe(true);
    expect(c.hint).toBe("Look over YouTube and X first.");
    expect(s.note).toBe("Look over YouTube and X first.");
    expect(barState({ ...base, step: "everywhere", enabledCount: 0 }).buttons[2].disabled).toBe(true);
  });
  test("Everywhere: moving on still works offline (nothing is sent from there)", () => {
    const s = barState({ ...base, step: "everywhere", online: false });
    expect(s.buttons[2].disabled).toBe(false);
    expect(s.note).toContain("offline");
  });
  test("Launch: Back to editing, Schedule, and one Publish named after the place", () => {
    const one = barState({ ...base, step: "launch", mode: "now", targets: ["youtube"] });
    expect(one.buttons.map((b) => b.label)).toEqual(["Back to editing", "Schedule", "Publish to YouTube"]);
    expect(one.buttons.filter((b) => b.primary)).toHaveLength(1);
    const three = barState({ ...base, step: "launch", mode: "now", enabledCount: 3, targets: ["instagram", "youtube", "x"] });
    expect(three.buttons[2].label).toBe("Publish to 3 platforms");
    const later = barState({ ...base, step: "launch", mode: "schedule", targets: ["youtube"] });
    expect(later.buttons.map((b) => b.label)).toEqual(["Back to editing", "Publish now", "Schedule post"]);
  });
  test("Launch: offline, not ready or a bad time keeps the primary off with a reason", () => {
    expect(barState({ ...base, step: "launch", online: false, targets: ["youtube"] }).buttons[2].disabled).toBe(true);
    const held = barState({ ...base, step: "launch", ready: false, targets: [] });
    expect(held.buttons[2].disabled).toBe(true);
    expect(held.note).toContain("aren't ready");
    const past = barState({ ...base, step: "launch", mode: "schedule", targets: ["youtube"], scheduleIssue: "Pick a time in the future." });
    expect(past.buttons[2].disabled).toBe(true);
    expect(past.note).toBe("Pick a time in the future.");
    expect(barState({ ...base, step: "launch", launching: true, targets: ["youtube"] }).buttons[2].label).toBe("Publishing");
    expect(barState({ ...base, step: "launch", mode: "schedule", launching: true, targets: ["youtube"] }).buttons[2].label).toBe("Scheduling");
  });
  test("Phase 4: Steps 1 and 2 use the same one-Continue bar", () => {
    expect(barState(base).buttons.map((b) => b.id)).toEqual(["continue"]);
    expect(barState({ ...base, step: "story" }).buttons.filter((b) => b.primary).map((b) => b.id)).toEqual(["continue"]);
  });
  test("publishLabel and the schedule time rule", () => {
    expect(publishLabel([], "now", PLATFORM_META)).toBe("Publish");
    expect(publishLabel(["instagram"], "now", PLATFORM_META)).toBe("Publish to Instagram");
    expect(publishLabel(["instagram", "x"], "schedule", PLATFORM_META)).toBe("Schedule post");
    const now = Date.parse("2026-11-15T10:00:00Z");
    expect(scheduleProblem(new Date(now - 1000), now)).toBe("Pick a time in the future.");
    expect(scheduleProblem(new Date(now + 3_600_000), now)).toBeNull();
    expect(scheduleProblem(new Date("nope"), now)).toBe("Pick a date and time.");
  });
});

describe("B3 Launch never sends a held place", () => {
  test("disconnected, expired, unreviewed and failing places are held with a reason", () => {
    const d = drafts({ youtube: {}, instagram: {}, x: { reviewed: false }, threads: { caption: "" } });
    const a = { ...conn(["youtube", "x", "threads"]), instagram: { status: "expired", username: "me_ig" } };
    const plan = launchPlan(d, a, vertical);
    expect(plan.send).toEqual(["youtube"]);
    const why = Object.fromEntries(plan.hold.map((h) => [h.platform, h.reason]));
    expect(why.instagram).toBe("The connection needs a refresh.");
    expect(why.x).toBe("Not looked over yet.");
    expect(why.threads).toBe("Add a caption.");
    expect(launchPlan(drafts({ tiktok: {} }), {}, vertical).hold[0]).toEqual({ platform: "tiktok", reason: "Not connected yet." });
  });
  test("the plan agrees with the gate: nothing held means ready", () => {
    const d = drafts({ youtube: {}, instagram: {} });
    const a = conn(["youtube", "instagram"]);
    expect(launchPlan(d, a, vertical).hold).toEqual([]);
    expect(launchGate(d, a, vertical).ready).toBe(true);
    const d2 = drafts({ youtube: {}, instagram: { reviewed: false } });
    expect(launchGate(d2, a, vertical).ready).toBe(false);
    expect(launchPlan(d2, a, vertical).send).toEqual(["youtube"]);
  });
  test("a place switched off is never listed at all", () => {
    const rows = confirmRows(drafts({ youtube: {} }), conn(["youtube", "instagram"]), vertical);
    expect(rows.map((r) => r.platform)).toEqual(["youtube"]);
    expect(rows[0]).toMatchObject({ handle: "@me_youtube", sending: true, reason: null });
  });
  test("confirmation rows carry warnings and practice accounts", () => {
    const rows = confirmRows(drafts({ instagram: {} }), { instagram: { status: "connected", username: "@me", mock: true } }, { duration: 30, width: 1920, height: 1080 });
    expect(rows[0].handle).toBe("@me");
    expect(rows[0].practice).toBe(true);
    expect(rows[0].warnings[0]).toContain("Horizontal");
  });
  test("the workspace refuses to launch while anything is held", () => {
    const ws = src("components/create/CreateWorkspace.tsx");
    expect(ws).toContain("if (plan.hold.length || !plan.send.length) return setLaunchError(");
    expect(ws).toContain("onLeaveOut={(p) => onDraft(p, { enabled: false })}");
  });
});

describe("B2F Pip suggestions are proposed, never written over", () => {
  const copy: PlatformCopy = { platform: "youtube", title: "New title", caption: "", description: "How to build a routine", hashtags: "#routine #shorts", note: "YouTube wants a stronger title" };
  test("an empty draft is filled straight away", () => {
    const r = routeCopy(emptyDraft(true), copy, "Myth Buster");
    expect(r.kind).toBe("fill");
    if (r.kind === "fill") expect(r.patch).toMatchObject({ title: "New title", why: "Myth Buster", reviewed: false });
    expect(isEmptyDraft({ title: " ", caption: "", description: "\n", hashtags: "" })).toBe(true);
  });
  test("a draft with words gets a proposal of only what changes", () => {
    const d = good({ title: "Old title", caption: "", description: "How to build a routine", hashtags: "#routine" });
    const r = routeCopy(d, copy, "Curiosity hook");
    expect(r.kind).toBe("propose");
    if (r.kind === "propose") expect(r.proposal).toEqual({ patch: { title: "New title", hashtags: "#routine #shorts" }, why: "Curiosity hook" });
    expect(routeCopy(good({ title: "New title", caption: "", description: "How to build a routine", hashtags: "#routine #shorts" }), copy, "").kind).toBe("same");
  });
  test("accept applies it and keeps the old words; revert puts them back", () => {
    const d = good({ title: "Old title", hashtags: "#routine" });
    let s = suggest(NO_SUGGESTIONS, { t: "propose", p: "youtube", proposal: { patch: { title: "New title", hashtags: "#new" }, why: "x" } }).state;
    expect(s.proposals.youtube).toBeDefined();
    const a = suggest(s, { t: "accept", p: "youtube", draft: d });
    // P3 review 6: accepted words have not been looked over yet, so the place is unreviewed until checked again.
    expect(a.apply).toEqual({ title: "New title", hashtags: "#new", reviewed: false });
    expect(a.state.proposals.youtube).toBeUndefined();
    expect(a.state.undo.youtube).toEqual({ title: "Old title", hashtags: "#routine", reviewed: true });
    s = a.state;
    const r = suggest(s, { t: "revert", p: "youtube" });
    expect(r.apply).toEqual({ title: "Old title", hashtags: "#routine", reviewed: true });
    expect(r.state.undo.youtube).toBeUndefined();
  });
  test("reject drops it and changes nothing; actions with nothing to act on are no-ops", () => {
    const s = suggest(NO_SUGGESTIONS, { t: "propose", p: "x", proposal: { patch: { caption: "y" }, why: "" } }).state;
    const r = suggest(s, { t: "reject", p: "x" });
    expect(r.apply).toBeNull();
    expect(r.state.proposals.x).toBeUndefined();
    expect(suggest(NO_SUGGESTIONS, { t: "accept", p: "x", draft: good() })).toEqual({ state: NO_SUGGESTIONS, apply: null });
    expect(suggest(NO_SUGGESTIONS, { t: "revert", p: "x" })).toEqual({ state: NO_SUGGESTIONS, apply: null });
  });
  test("one platform's suggestion never touches another's", () => {
    let s = suggest(NO_SUGGESTIONS, { t: "propose", p: "x", proposal: { patch: { caption: "a" }, why: "" } }).state;
    s = suggest(s, { t: "propose", p: "instagram", proposal: { patch: { caption: "b" }, why: "" } }).state;
    const a = suggest(s, { t: "accept", p: "x", draft: good() });
    expect(a.state.proposals.instagram).toEqual({ patch: { caption: "b" }, why: "" });
  });
  test("the workspace routes all written copy through it and passes the contract props", () => {
    const ws = src("components/create/CreateWorkspace.tsx");
    expect(ws).toContain("routeCopy(draftsRef.current[c.platform], c, whyLine(c.why))");
    for (const k of ["proposals={sugg.proposals}", "undo={sugg.undo}", "onAccept={", "onReject={", "onRevert={"]) expect(ws).toContain(k);
    expect(ws).not.toContain("onContinue=");
  });
});

describe("B5 Pip is step aware and never claims a send", () => {
  test("Everywhere lines", () => {
    expect(deckLine("youtube", good({ reviewed: false, note: "YouTube wants a stronger title" }), false)).toBe("YouTube wants a stronger title");
    expect(deckLine("youtube", good(), false)).toBe("YouTube looks good to you.");
    expect(deckLine("x", good(), true)).toContain("Accept, edit or skip");
  });
  test("Launch lines list what is held, then what to press", () => {
    const held = launchLine({ hold: [{ platform: "instagram", reason: "Not connected yet." }], sending: ["youtube"], mode: "now" });
    expect(held.lead).toBe("One place won't go yet:");
    expect(held.items).toEqual(["Instagram: Not connected yet."]);
    expect(launchLine({ hold: [], sending: ["youtube"], mode: "now" }).lead).toContain("Press Publish below");
    expect(launchLine({ hold: [], sending: ["youtube", "x"], mode: "schedule" }).lead).toContain("YouTube and X");
    for (const l of [held, launchLine({ hold: [], sending: ["youtube"], mode: "now" }), launchLine({ hold: [], sending: ["youtube"], mode: "schedule" })]) {
      expect([l.lead, ...l.items].join(" ")).not.toMatch(/\b(is live|published|scheduled|went out|it's out)\b/i);
    }
  });
  test("the conversation is one mounted element and the panel is never folded by a step", () => {
    const s = panelReducer(PANEL_OPEN, { t: "step", step: "launch" });
    expect(s.open).toBe(true);
    const closed = panelReducer(PANEL_OPEN, { t: "toggle" });
    expect(panelReducer(closed, { t: "step", step: "launch" }).open).toBe(false);
    expect(panelReducer(panelReducer(closed, { t: "step", step: "launch" }), { t: "step", step: "everywhere" }).open).toBe(false);
    const ws = src("components/create/CreateWorkspace.tsx");
    expect(ws.match(/\{assistant\}/g)?.length).toBe(1);
  });
});

describe("B3 music help only for the places picked", () => {
  test("lines follow the selection, in order", () => {
    expect(musicLines(["youtube"]).map((l) => l.platform)).toEqual(["youtube"]);
    expect(musicLines(["youtube", "instagram"]).map((l) => l.platform)).toEqual(["instagram", "youtube"]);
    expect(musicLines([])).toEqual([]);
    expect(musicLines(["youtube"])[0].text).not.toContain("Instagram");
  });
  test("nothing ever calls music safe", () => {
    const note = src("components/create/MusicNote.tsx");
    for (const t of Object.values(MUSIC_RULES)) expect(t).not.toMatch(/safe/i);
    expect(note).not.toMatch(/safe/i);
    expect(note).toContain("<details");
    expect(note).not.toMatch(/<details[^>]*\bopen\b/);
  });
});

describe("B1 layout and B2G rail", () => {
  const ws = src("components/create/CreateWorkspace.tsx");
  const rail = src("components/create/JourneyRail.tsx");
  const lp = src("components/create/LaunchPanel.tsx");
  test("the rail shows from 1280px at 200px, with no preview card", () => {
    expect(rail).toContain('export const RAIL_SHOW = "xl:flex";');
    expect(rail).toContain("w-[200px]");
    expect(rail).not.toContain("min-[1800px]");
    expect(rail).not.toContain("<img");
    expect(rail).not.toContain("Draft saved");
    expect(ws).toContain("status={railStatus}");
  });
  test("Everywhere and Launch get the wide workspace that grows when Pip folds", () => {
    expect(ws).toContain('const roomy = stage || step === "everywhere" || step === "launch";');
    expect(ws).toContain('roomy ? (pipShown ? "max-w-[1100px]" : "max-w-[1240px]")');
    expect(lp).not.toContain("max-w-2xl");
    expect(lp).toContain("lg:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]");
  });
  test("Launch has no send button of its own and none of the old labels", () => {
    for (const old of ["Send it everywhere", "Send it now", "Schedule it\"", "onLaunch"]) expect(lp).not.toContain(old);
    expect(lp).toContain('"Publish now" : "Schedule for later"');
    expect(ws.match(/<ActionBar/g)?.length).toBe(1);
  });
  test("Pip folds in 300ms on the one easing, and steps move in 420ms", () => {
    expect(ws).toContain("xl:transition-[width,opacity] xl:duration-300 xl:ease-[cubic-bezier(0.16,1,0.3,1)]");
    expect(ws).toContain("transition={T.page}");
    expect(ws).not.toContain("transition-all");
  });
  test("no em or en dashes in the files this round touched", () => {
    for (const f of ["CreateWorkspace.tsx", "JourneyRail.tsx", "ActionBar.tsx", "LaunchPanel.tsx", "MusicNote.tsx", "Assistant.tsx", "assistant-state.ts", "publish.ts", "CoverPicker.tsx"]) expect(src(`components/create/${f}`), f).not.toMatch(/[\u2013\u2014]/);
  });
});
