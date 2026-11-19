import { acceptProposal } from "./deck-logic";
import { FRESH } from "./review-state";
import type { Proposal, Undo } from "./proposal";
import type { Draft, PlatformCopy, Step } from "./types";
import type { Platform } from "@/lib/domain";
import type { CaptionState } from "./captions/run-store";
import { CAPTION_LANGUAGES, isEnglish, languageName } from "@/lib/captions/languages";

/**
 * The assistant panel on wide screens. `restore` is kept for older saved states; Phase 3 (B1, B5) no longer
 * folds the panel on Launch, since Launch now has the same three regions as Everywhere and Pip reviews it.
 */
export type PanelState = { open: boolean; restore: boolean | null };
export type PanelAction = { t: "step"; step: Step } | { t: "toggle" } | { t: "set"; open: boolean };

export const PANEL_OPEN: PanelState = { open: true, restore: null };
/** 1170: open or folded is remembered in this browser ("closed" or "open"), so Pip stays the way it was left. */
export const PIP_PANEL_KEY = "outlly:pip-panel";

export function panelReducer(s: PanelState, a: PanelAction): PanelState {
  if (a.t === "toggle") return { open: !s.open, restore: null };
  // 1170: the creator's last choice, read back from this browser when Create opens.
  if (a.t === "set") return s.open === a.open && s.restore === null ? s : { open: a.open, restore: null };
  // A step change never opens or closes the panel: the creator's own choice carries across every step.
  return s.restore === null ? s : { open: s.restore, restore: null };
}

/**
 * Phase 4 (4): on Everywhere and Launch the hook already sits in its own field, so Pip shows only its latest
 * message there and the conversation (with the suggested hook) folds behind "Show conversation".
 */
export const foldsConversation = (step: Step) => step === "everywhere" || step === "launch";

/* ---------------- 1182: Pip opens by itself on Steps 1 and 2 and folds once the caption is final ---------------- */

/** The caption is final once a hook is picked on Your Story. The hook is saved with the draft, so a reload keeps it. */
export const captionFinal = (hook: string | null | undefined) => !!hook?.trim();

/**
 * Entering Your Video opens Pip until the caption is final; R1198: entering Your Story always opens it, since its
 * asks work on the captions written there. Any other step leaves Pip the way it is. Called only when a step is entered, never on a keystroke.
 */
export const pipOpensOn = (step: Step, finalized: boolean) => step === "story" || (!finalized && step === "video");

export type PipFooterId = "story" | "finalize" | "everywhere" | "done" | "edit";
export type PipFooter = { id: PipFooterId; label: string; disabled: boolean; hint: string | null };

/**
 * The one lit button at the foot of Pip, by step. Each runs the same move as the page (Continue, Use this,
 * Back to editing), so Pip never skips a check the page makes. Closing Pip is a separate button and never
 * finalizes, saves or sends anything.
 */
export function pipFooter(x: { step: Step; storyOpen: boolean; storyWhy?: string | null; finalized: boolean; canFinalize: boolean; busy?: boolean; composer?: boolean }): PipFooter {
  if (x.step === "video") return { id: "story", label: "Continue to Your Story", disabled: !x.storyOpen, hint: x.storyOpen ? null : (x.storyWhy ?? "Add a video first.") };
  if (x.step === "story") {
    if (x.finalized && !x.canFinalize) return { id: "everywhere", label: "Continue to Everywhere", disabled: false, hint: null };
    // 1190: the captions are written from the message on the page, so that is what the footer waits for.
    if (x.composer && !x.canFinalize) return { id: "everywhere", label: "Continue to Everywhere", disabled: true, hint: "Write your caption on the page first. Pip writes each platform's version on Everywhere." };
    const why = x.busy ? "Writing your hook…" : "Write your caption first.";
    return { id: "finalize", label: "Finalize caption", disabled: !x.canFinalize || !!x.busy, hint: x.canFinalize && !x.busy ? null : why };
  }
  if (x.step === "everywhere") return { id: "done", label: "Done", disabled: false, hint: null };
  return { id: "edit", label: "Back to editing", disabled: false, hint: null };
}

/** What Pip knows about the caption run, as a short string so a reader re-renders only when one of these changes. */
export type CaptionFacts = { lines: number; busy: "transcribe" | "translate" | "burn" | null; failed: boolean; gaps: number; spoken: string; english: boolean; ai: boolean | null };
export const captionFactsKey = (s: CaptionState) =>
  JSON.stringify({ lines: s.tracks.orig.length, busy: s.busy?.kind ?? null, failed: s.outcome === "failed", gaps: s.gaps.length, spoken: s.langPick !== "auto" ? s.langPick : s.heard, english: !!s.tracks.en, ai: s.aiReady } satisfies CaptionFacts);

/**
 * Pip's caption notes on Your Story, from the real run: what to press next, what went wrong, and the
 * translation only when the editor really offers it (AI on, lines made, not already English).
 */
export function captionTips(f: CaptionFacts): string[] {
  if (f.ai === false) return [];
  const out: string[] = [];
  if (f.busy === "transcribe") out.push("Transcribing your video now. It keeps going if you move on to the next step.");
  else if (f.busy === "translate") out.push("Translating your captions to English now.");
  else if (f.failed) out.push("The last caption run didn't finish. Press Transcribe with AI again under Captions on the video, or pick the spoken language yourself first.");
  else if (f.lines === 0 && !f.busy)
    out.push(`Want words on the video? Under Captions on the video, pick the spoken language (${CAPTION_LANGUAGES.length} to choose from, Telugu, Tamil and Hindi among them) or Detect it for me, then press Transcribe with AI.`);
  if (f.gaps > 0) out.push(f.gaps === 1 ? "One part of the video came back without words. Retry it in the caption editor." : `${f.gaps} parts of the video came back without words. Retry them in the caption editor.`);
  const foreign = !!f.spoken && !isEnglish(f.spoken);
  if (f.lines > 0 && !f.busy && foreign) {
    const name = languageName(f.spoken);
    out.push(f.english ? `Your captions are in ${name} with an English track too. Switch between Original and English in the caption editor; both keep the same timing.` : `Your captions are in ${name}. Translate to English adds an English track with the same timing, and you can switch between them.`);
  }
  return out;
}

/** A plain fact about the hook on show: its length, and a nudge only when it runs long for a first line. */
export function hookNote(text: string): string | null {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (!words) return null;
  return words > 16 ? `${words} words. That's long for a first line; Make it punchier trims it.` : `${words} words, short enough to read in one glance.`;
}

/** Nothing but spaces is not a caption. */
export const canSaveCaption = (text: string) => text.trim().length > 0;

/** What the writer works from: the creator's edited Original caption wins over the story they typed. */
export function captionSource(x: { edited: string | null; submittedStory: string | null; story: string }) {
  return x.edited?.trim() || x.submittedStory || x.story;
}

/* ---------------- Phase 3 (B2F): Pip suggestions are proposed, never written over the creator's words ---------------- */

const TEXT_KEYS = ["title", "caption", "description", "hashtags"] as const;
type TextKey = (typeof TEXT_KEYS)[number];

export const isEmptyDraft = (d: Pick<Draft, TextKey>) => TEXT_KEYS.every((k) => !d[k].trim());

/**
 * Where a piece of written copy goes. An empty draft has nothing to lose, so it is filled straight away.
 * A draft with words in it gets a proposal holding only the fields that would change; identical copy is dropped.
 */
export function routeCopy(d: Draft, c: PlatformCopy, why: string): { kind: "fill"; patch: Partial<Draft> } | { kind: "propose"; proposal: Proposal } | { kind: "same" } {
  const next: Record<TextKey, string> = { title: c.title ?? "", caption: c.caption ?? "", description: c.description ?? "", hashtags: c.hashtags ?? "" };
  if (isEmptyDraft(d)) return { kind: "fill", patch: { ...next, note: c.note, why, ...FRESH } };
  const patch: Partial<Draft> = {};
  for (const k of TEXT_KEYS) if (next[k] !== d[k]) patch[k] = next[k];
  if (!Object.keys(patch).length) return { kind: "same" };
  return { kind: "propose", proposal: { patch, why: why || c.note } };
}

/**
 * R1198: what one of Pip's asks would change, as a suggestion. Always a proposal, even on a place still holding
 * Pip's own words: an ask is applied only when the creator accepts it. Null when nothing would change.
 */
export function askProposal(d: Draft, c: PlatformCopy, keys: readonly TextKey[], why: string): Proposal | null {
  const next: Record<TextKey, string> = { title: c.title ?? d.title, caption: c.caption ?? d.caption, description: c.description ?? d.description, hashtags: c.hashtags ?? d.hashtags };
  const patch: Partial<Draft> = {};
  for (const k of keys) if (next[k].trim() && next[k] !== d[k]) patch[k] = next[k];
  if (!Object.keys(patch).length) return null;
  return { patch, why: why || c.note || "Pip's take on your words." };
}

/** R1198: the place Pip's asks work on. The one the creator last touched, if it is still switched on, else the first. */
export const pipTarget = (focus: Platform | null, places: readonly Platform[]): Platform | null => (focus && places.includes(focus) ? focus : (places[0] ?? null));

export type Suggestions = { proposals: Partial<Record<Platform, Proposal>>; undo: Partial<Record<Platform, Undo>> };
export const NO_SUGGESTIONS: Suggestions = { proposals: {}, undo: {} };

export type SuggestAction =
  | { t: "propose"; p: Platform; proposal: Proposal }
  /** `draft` is the platform's draft as it stands, so Revert can put back exactly what Accept replaced. */
  | { t: "accept"; p: Platform; draft: Draft }
  | { t: "reject"; p: Platform }
  | { t: "revert"; p: Platform };

const without = <V>(r: Partial<Record<Platform, V>>, p: Platform) => {
  const out = { ...r };
  delete out[p];
  return out;
};

/** Pure. The caller applies `apply` through onDraft, so the drafts state keeps one writer. */
export function suggest(s: Suggestions, a: SuggestAction): { state: Suggestions; apply: Partial<Draft> | null } {
  if (a.t === "propose") return { state: { ...s, proposals: { ...s.proposals, [a.p]: a.proposal } }, apply: null };
  if (a.t === "reject") return { state: { ...s, proposals: without(s.proposals, a.p) }, apply: null };
  if (a.t === "accept") {
    const pr = s.proposals[a.p];
    if (!pr) return { state: s, apply: null };
    const { patch, undo } = acceptProposal(a.p, a.draft, pr);
    return { state: { proposals: without(s.proposals, a.p), undo: { ...s.undo, [a.p]: undo } }, apply: patch };
  }
  const u = s.undo[a.p];
  if (!u) return { state: s, apply: null };
  return { state: { ...s, undo: without(s.undo, a.p) }, apply: u };
}
