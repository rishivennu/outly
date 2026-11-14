/**
 * 1148: the rules every toast follows, kept pure so they are unit tested. An error stays until it is dismissed
 * (someone looking away for a second must not miss it); everything else stays at least 6 s, and the clock
 * stops while the pointer or keyboard focus is on the toast (WCAG 2.2.1).
 */
export type ToastTone = "ok" | "info" | "error";
export type ToastCloseReason = "timeout" | "dismiss" | "action";
export type ToastOptions = {
  /** One button next to the text, e.g. Undo. Pressing it closes the toast. */
  action?: { label: string; onClick: () => void };
  /** How long it stays, in ms. Never below TOAST_MIN_MS; ignored for errors. */
  duration?: number;
  /** Called once when the toast goes, with why. */
  onClose?: (reason: ToastCloseReason) => void;
};

export const TOAST_MIN_MS = 6000;

/** null = stays until dismissed. */
export function toastDuration(tone: ToastTone, duration?: number): number | null {
  if (tone === "error") return null;
  return Math.max(TOAST_MIN_MS, Number.isFinite(duration) ? (duration as number) : TOAST_MIN_MS);
}

type Clock = { now: () => number; set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };
const realClock: Clock = { now: () => Date.now(), set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** A timer that can be paused and resumed, keeping the time that was left. */
export function countdown(ms: number, onDone: () => void, clock: Clock = realClock) {
  let left = ms;
  let startedAt = 0;
  let handle: unknown = null;
  let done = false;
  const fire = () => {
    handle = null;
    done = true;
    onDone();
  };
  const resume = () => {
    if (done || handle !== null) return;
    startedAt = clock.now();
    handle = clock.set(fire, Math.max(0, left));
  };
  const pause = () => {
    if (done || handle === null) return;
    clock.clear(handle);
    handle = null;
    left -= clock.now() - startedAt;
  };
  const cancel = () => {
    if (handle !== null) clock.clear(handle);
    handle = null;
    done = true;
  };
  resume();
  return { pause, resume, cancel, left: () => (handle === null ? left : left - (clock.now() - startedAt)) };
}
