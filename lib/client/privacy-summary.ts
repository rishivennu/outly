/*
 * Phase 4: the short data summary lives in the cookie banner, so a first visit meets one surface, not two.
 * Answering the banner in a tab counts as having seen the summary for this version, and the studio's
 * "How Outlly handles your data" notice then stays away for that person (it is still in Settings, Your data).
 * Bump PRIVACY_VERSION when what we collect, who receives it or how long we keep it changes. Keep it in step with /privacy.
 */
export const PRIVACY_VERSION = "2026-10-18b";

export const PRIVACY_SUMMARY = [
  "We keep your account, your videos and posts, and the numbers your connected accounts report.",
  "Only services doing a job for you get it: the platforms you post to, Google Gemini for AI features, payments, email and hosting.",
  "We never sell your data, show ads or train AI models on your videos.",
] as const;

const KEY = "outlly:privacy-summary";
// Also kept in memory, so a tab that refuses sessionStorage still counts it.
let answered: string | null = null;

/** The banner (with the summary) was answered in this tab. */
export function markSummaryAnswered(store: Pick<Storage, "setItem"> | null = safeSession()) {
  answered = PRIVACY_VERSION;
  try {
    store?.setItem(KEY, PRIVACY_VERSION);
  } catch {
    /* memory alone is enough for this tab */
  }
}

export function summaryAnsweredThisSession(store: Pick<Storage, "getItem"> | null = safeSession()) {
  if (answered === PRIVACY_VERSION) return true;
  try {
    return store?.getItem(KEY) === PRIVACY_VERSION;
  } catch {
    return false;
  }
}

/** For tests: forget the in-memory answer. */
export function resetSummaryMemory() {
  answered = null;
}

function safeSession(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}
