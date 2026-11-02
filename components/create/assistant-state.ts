import type { Step } from "./types";

/**
 * The assistant panel on wide screens. `restore` remembers what the panel was before the
 * Launch step folded it away; `null` means the Launch step is not holding it closed.
 */
export type PanelState = { open: boolean; restore: boolean | null };
export type PanelAction = { t: "step"; step: Step } | { t: "toggle" };

export const PANEL_OPEN: PanelState = { open: true, restore: null };

export function panelReducer(s: PanelState, a: PanelAction): PanelState {
  if (a.t === "toggle") return { open: !s.open, restore: s.restore };
  // Arriving at Launch folds it once and keeps what it was. Staying on Launch leaves the creator's own choice alone.
  if (a.step === "launch") return s.restore === null ? { open: false, restore: s.open } : s;
  return s.restore === null ? s : { open: s.restore, restore: null };
}

/** Nothing but spaces is not a caption. */
export const canSaveCaption = (text: string) => text.trim().length > 0;

/** What the writer works from: the creator's edited Original caption wins over the story they typed. */
export function captionSource(x: { edited: string | null; submittedStory: string | null; story: string }) {
  return x.edited?.trim() || x.submittedStory || x.story;
}
