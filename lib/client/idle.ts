/**
 * 1150: background polls cost a server call each, and a tab left open and visible on a desk polled all day.
 * pollable() is true only while the tab is visible AND the person did something in the last few minutes
 * (pointer, key, scroll, touch, focus, coming back to the tab). Any of those wakes it, and the poll that was
 * skipped runs on its next tick. Never use it to stop work the person is watching start to finish (a send in progress).
 */
export const IDLE_MS = 5 * 60_000;

let last = Date.now();
let wired = false;

function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  const mark = () => {
    last = Date.now();
  };
  for (const e of ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchstart", "focus"]) window.addEventListener(e, mark, { passive: true, capture: true });
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && mark());
}
wire();

export function pollable(idleMs = IDLE_MS, now = Date.now()) {
  if (typeof document === "undefined") return false;
  wire();
  return document.visibilityState === "visible" && now - last < idleMs;
}

/** Test hook: pretend the last activity was at `at`. */
export function _setLastActivity(at: number) {
  last = at;
}
