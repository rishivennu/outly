import type { Draft } from "@/lib/client/checks";

/**
 * R1209: a platform caption is in one of three states, and only Approved ever goes out.
 * Pip writes (or rewrites) it: Needs review. The creator types in it: Edited. They approve it: Approved.
 * Typing in an approved caption puts it back to Needs review until it is approved again.
 */
export type ReviewKind = "needs-review" | "edited" | "approved";

export const REVIEW_LABEL: Record<ReviewKind, string> = { "needs-review": "Needs review", edited: "Edited", approved: "Approved" };

/** The words a creator can change on a platform. Changing any of them is an edit. */
export const EDIT_KEYS = ["title", "caption", "description", "hashtags", "firstComment"] as const;

export function reviewKind(d: Pick<Draft, "reviewed" | "edited" | "reopened">): ReviewKind {
  if (d.reviewed) return "approved";
  if (d.reopened) return "needs-review";
  return d.edited ? "edited" : "needs-review";
}

/** Fresh words from Pip (written in, regenerated or an accepted suggestion): looked at again from the start. */
export const FRESH: Pick<Draft, "reviewed" | "edited" | "reopened"> = { reviewed: false, edited: false, reopened: false };

/** Approving clears the edit marks, so taking the approval back reads Needs review. */
export const APPROVE: Pick<Draft, "reviewed" | "edited" | "reopened"> = { reviewed: true, edited: false, reopened: false };

/**
 * Pure. What the creator's own typing does to the state. A patch that sets `reviewed` itself (Approve, a fresh
 * version from Pip, an accepted suggestion, Revert) is the caller's decision and passes through untouched.
 */
export function withEditState(d: Draft, patch: Partial<Draft>): Partial<Draft> {
  if ("reviewed" in patch) return patch;
  const typed = EDIT_KEYS.some((k) => typeof patch[k] === "string" && patch[k] !== d[k]);
  if (!typed) return patch;
  if (d.reviewed) return { ...patch, reviewed: false, edited: false, reopened: true };
  if (d.reopened) return patch;
  return d.edited ? patch : { ...patch, edited: true };
}

/** Has words worth approving: a caption, a description or a title. Hashtags alone are not a post. */
export const hasCopy = (d: Pick<Draft, "title" | "caption" | "description">) => !!(d.title + d.caption + d.description).trim();
