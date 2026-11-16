import { acceptProposal } from "./deck-logic";
import type { Proposal, Undo } from "./proposal";
import type { Draft, PlatformCopy, Step } from "./types";
import type { Platform } from "@/lib/domain";

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
  if (isEmptyDraft(d)) return { kind: "fill", patch: { ...next, note: c.note, why, reviewed: false } };
  const patch: Partial<Draft> = {};
  for (const k of TEXT_KEYS) if (next[k] !== d[k]) patch[k] = next[k];
  if (!Object.keys(patch).length) return { kind: "same" };
  return { kind: "propose", proposal: { patch, why: why || c.note } };
}

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
