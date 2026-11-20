/**
 * R1265: a caption run lives in the tab (audio and video are worked on in the browser), so a reload cannot resume
 * it. While one runs, a small marker sits in sessionStorage; the editor for the same video after a reload reads it
 * and offers to start again instead of the run vanishing without a word.
 */

export type RunStage = "transcribe" | "translate" | "burn";
export type RunMarker = { key: string; stage: RunStage; at: number };
export type MarkerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const RUN_MARKER_KEY = "outly-caption-run";
export const RUN_MARKER_TTL = 30 * 60 * 1000;

const STAGES: readonly RunStage[] = ["transcribe", "translate", "burn"];

export function sessionStore(): MarkerStorage | null {
  try {
    return typeof window !== "undefined" && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    // Storage can be switched off (privacy settings); the run still works, only the reload notice is lost.
    return null;
  }
}

export function writeMarker(store: MarkerStorage | null, key: string, stage: RunStage, now = Date.now()) {
  if (!store || !key) return;
  try {
    store.setItem(RUN_MARKER_KEY, JSON.stringify({ key, stage, at: now } satisfies RunMarker));
  } catch {
    // Quota or private mode: nothing to keep.
  }
}

export function clearMarker(store: MarkerStorage | null) {
  try {
    store?.removeItem(RUN_MARKER_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** The marker if it is well formed and not older than the TTL. A marker from the future (clock change) is kept. */
export function readMarker(store: MarkerStorage | null, now = Date.now()): RunMarker | null {
  let raw: string | null = null;
  try {
    raw = store?.getItem(RUN_MARKER_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as Partial<RunMarker>;
    if (typeof m?.key !== "string" || !m.key || !STAGES.includes(m.stage as RunStage) || typeof m.at !== "number" || !Number.isFinite(m.at)) return null;
    if (now - m.at > RUN_MARKER_TTL) return null;
    return { key: m.key, stage: m.stage as RunStage, at: m.at };
  } catch {
    return null;
  }
}

export const stageLabel = (stage: RunStage) => (stage === "transcribe" ? "generated" : stage === "translate" ? "translated" : "burned in");

export const interruptedLine = (stage: RunStage) => `Your captions were still being ${stageLabel(stage)} when the page reloaded. Start again to pick up from the video.`;

/** What "Start again" runs: the same action, from scratch. Without lines to translate or burn, it transcribes first. */
export const restartAction = (stage: RunStage, hasLines: boolean): RunStage => (stage === "transcribe" || !hasLines ? "transcribe" : stage);
