/**
 * Draft collaboration (1037): pure rules, unit-tested. Several people edit one draft; owners and managers
 * approve it in the app (or a client approves through a review link, as before).
 */

export type CopyShape = {
  mediaId?: string | null;
  title?: string | null;
  story?: string | null;
  hook?: string | null;
  targets?: { platform: string; title?: string | null; caption?: string | null; description?: string | null; hashtags?: string | null; firstComment?: string | null }[];
};

const norm = (v: string | null | undefined) => (v ?? "").trim();
const FIELDS = ["title", "caption", "description", "hashtags", "firstComment"] as const;

/**
 * Did the words, the video or the destinations change? Autosave sends the whole draft every few seconds,
 * so only a real difference counts as an edit (and only a real edit needs approving again).
 * A field the client didn't send (undefined) is not a change.
 */
export function copyChanged(before: CopyShape & { targets: NonNullable<CopyShape["targets"]> }, after: CopyShape, opts: { replaceTargets?: boolean } = {}) {
  if (after.mediaId !== undefined && after.mediaId !== before.mediaId) return true;
  for (const k of ["title", "story", "hook"] as const) if (after[k] !== undefined && norm(after[k]) !== norm(before[k])) return true;
  if (!after.targets) return false;
  const was = new Map(before.targets.map((t) => [t.platform, t]));
  if (opts.replaceTargets) {
    const now = new Set(after.targets.map((t) => t.platform));
    if (now.size !== was.size || [...now].some((p) => !was.has(p))) return true;
  }
  for (const t of after.targets) {
    const w = was.get(t.platform);
    if (!w) return true;
    for (const f of FIELDS) if (t[f] !== undefined && norm(t[f]) !== norm(w[f])) return true;
  }
  return false;
}

/** An approval only counts for the version it saw: one older than the last edit doesn't clear the post. */
export function approvalCurrent(reviews: { status: string; decidedAt: Date | string | null }[], editedAt: Date | string | null) {
  const cut = editedAt ? +new Date(editedAt) : 0;
  return reviews.some((r) => r.status === "approved" && r.decidedAt !== null && +new Date(r.decidedAt) >= cut);
}

/** Who may approve in the app: the owner always; a manager, but not for a change they made themselves. */
export function approveBlock(role: "owner" | "manager" | "editor", actorId: string, editedById: string | null): string | null {
  if (role === "editor") return "Editors can't approve posts. Ask the owner or a manager.";
  if (role === "manager" && editedById && editedById === actorId) return "You made the last change, so someone else has to approve it.";
  return null;
}

/** Autosave mustn't flood the activity list: one "edited" line per person per window. */
export const EDIT_NOTE_WINDOW_MS = 15 * 60_000;
export function shouldLogEdit(last: { kind: string; authorId: string; createdAt: Date | string } | null, actorId: string, now = Date.now()) {
  if (!last || last.kind !== "edit" || last.authorId !== actorId) return true;
  return now - +new Date(last.createdAt) > EDIT_NOTE_WINDOW_MS;
}
