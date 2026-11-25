/**
 * R1335: the "Help improve Outlly AI" consent, pure half (no db; client components import it). What the consent covers, the exact
 * copy the user reads, and how a stored row set becomes the state the UI and the pipeline act on.
 *
 * Consent is separate from the plan (lib/intelligence/entitlements-core.ts): a Free creator may consent and still has no
 * Personal Intelligence; a paid creator may decline and keeps every personal feature. It is never preselected: no row
 * means no consent. The record is append-only; the newest row per user is the current state and the rest is the audit.
 */

export const CONSENT_TYPE = "shared-model" as const;

/** Bump when the explanation or the covered categories change: a grant under an older version is shown as needing a fresh yes. */
export const CONSENT_POLICY_VERSION = "2026-11-25.1";

/** The data categories the shared pipeline reads today (lib/intelligence/shared.ts): nothing outside this list is collected. */
export const CONSENT_CATEGORIES = ["content_metadata", "performance_signals", "production_signals"] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<ConsentCategory, { label: string; detail: string }> = {
  content_metadata: { label: "Content metadata", detail: "Platform, format, duration, publishing day and time, posting gaps, content category." },
  performance_signals: { label: "Performance signals", detail: "Views and views per follower at set ages, engagement rate; only what the connected platform exposes." },
  production_signals: { label: "Content-production signals", detail: "Caption structure, hook type, hashtag and emoji counts, cover and first-comment use." },
};

/** Never contributed, consent or not. Shown next to the switch so the promise is explicit. */
export const NEVER_INCLUDED = [
  "Your uploaded videos or images",
  "Transcripts, captions or scripts as written",
  "Comments, messages or anyone in your audience",
  "Account credentials or platform tokens",
  "Unpublished drafts",
] as const;

export const CONSENT_TITLE = "Help improve Outlly AI";
export const CONSENT_EXPLANATION =
  "Allow Outlly to use eligible, de-identified product and content-performance signals to improve our shared AI models. This does not enable Personal Intelligence features on your account.";
/** Honest about what withdrawal and deletion do: the shared document stores bucket medians, never a row of yours. */
export const WITHDRAW_NOTE = "Your posts leave the shared baselines at the next rebuild (within the hour). Earlier versions were built from group medians only; no row of yours is stored in them.";
export const DELETION_NOTE = "We rebuild the shared model without your posts at the next sweep and remove the record of which of your posts were used. Models already published hold group medians, not your rows, so there is nothing of yours left to remove from them.";

export type ConsentStatus = "granted" | "withdrawn";
export type ConsentSource = "settings" | "intelligence" | "onboarding" | "api";
export const CONSENT_SOURCES: readonly ConsentSource[] = ["settings", "intelligence", "onboarding", "api"];

/** A stored row, as consent.ts reads it (dates may arrive as strings over the wire). */
export interface ConsentRow {
  id: string;
  status: ConsentStatus | string;
  policyVersion: string;
  categories: string; // JSON string[]
  source: string;
  consentedAt: Date | string | null;
  withdrawnAt: Date | string | null;
  deletionRequestedAt: Date | string | null;
  deletionStatus: string | null;
  deletionDoneAt: Date | string | null;
  createdAt: Date | string;
}

export interface ConsentState {
  /** The newest row says granted. */
  granted: boolean;
  /** Granted under the current policy version; false means "ask again" (still counted as granted until they answer). */
  current: boolean;
  policyVersion: string | null;
  categories: ConsentCategory[];
  consentedAt: string | null;
  withdrawnAt: string | null;
  deletion: { requestedAt: string; status: "requested" | "done"; doneAt: string | null } | null;
  /** How many decisions are on file (0 = never asked, never answered). */
  decisions: number;
}

const iso = (d: Date | string | null | undefined): string | null => (d == null ? null : new Date(d).toISOString());

export function parseCategories(raw: string | null | undefined): ConsentCategory[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? (v.filter((c): c is ConsentCategory => (CONSENT_CATEGORIES as readonly string[]).includes(c)) as ConsentCategory[]) : [];
  } catch {
    return [];
  }
}

/** Fold the rows (any order) into the current state. The newest by createdAt wins; a deletion request on any row shows. */
export function consentState(rows: readonly ConsentRow[], policyVersion: string = CONSENT_POLICY_VERSION): ConsentState {
  if (!rows.length) return { granted: false, current: false, policyVersion: null, categories: [], consentedAt: null, withdrawnAt: null, deletion: null, decisions: 0 };
  const sorted = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const latest = sorted[0];
  const granted = latest.status === "granted";
  const del = sorted.find((r) => r.deletionRequestedAt);
  return {
    granted,
    current: granted && latest.policyVersion === policyVersion,
    policyVersion: latest.policyVersion,
    categories: granted ? parseCategories(latest.categories) : [],
    consentedAt: iso(latest.consentedAt),
    withdrawnAt: granted ? null : iso(latest.withdrawnAt),
    deletion: del ? { requestedAt: iso(del.deletionRequestedAt)!, status: del.deletionStatus === "done" ? "done" : "requested", doneAt: iso(del.deletionDoneAt) } : null,
    decisions: rows.length,
  };
}

/** The sentence under the switch for the state it is in. */
export function consentStatusLine(s: ConsentState): string {
  if (s.deletion && s.deletion.status === "requested") return "Deletion requested. Your posts leave the shared model at the next rebuild.";
  if (s.deletion && s.deletion.status === "done") return "Your contributed data was removed. You can opt in again any time.";
  if (s.granted && !s.current) return "Our explanation of this setting changed since you said yes. Please read it again and confirm.";
  if (s.granted && s.consentedAt) return `On since ${new Date(s.consentedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.`;
  if (!s.granted && s.withdrawnAt) return "Off. Your posts stay home.";
  return "Off by default. Nothing is shared until you turn this on.";
}

/** What the API returns for the consent itself (the route adds canChange, rules and history). */
export interface ConsentView {
  state: ConsentState;
  policyVersion: string;
  copy: { title: string; explanation: string; withdraw: string; deletion: string };
  categories: { key: ConsentCategory; label: string; detail: string }[];
  never: readonly string[];
}

export function consentView(state: ConsentState): ConsentView {
  return {
    state,
    policyVersion: CONSENT_POLICY_VERSION,
    copy: { title: CONSENT_TITLE, explanation: CONSENT_EXPLANATION, withdraw: WITHDRAW_NOTE, deletion: DELETION_NOTE },
    categories: CONSENT_CATEGORIES.map((key) => ({ key, ...CATEGORY_LABEL[key] })),
    never: NEVER_INCLUDED,
  };
}
