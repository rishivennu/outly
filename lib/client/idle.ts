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

/** R1208: how long since anyone used this tab, whether or not it is on screen (pollable() also wants it visible). */
export function idleFor(now = Date.now()) {
  wire();
  return now - last;
}

/**
 * R1208: when pollable() says no (tab hidden, or nobody at it), the admin bell still checks once a minute, so a new
 * Live Support request reaches the specialist as a desktop alert while they work in another tab or app. Only for
 * someone who takes live chats and has allowed desktop alerts (nobody else gets anything from a background check),
 * and not after 10 hours with nobody at the tab (a tab left open overnight stops costing server calls). The 10 hours
 * count use of THIS tab only: someone working in other apps all day without touching it stops getting these alerts
 * after 10 hours (the phone alerts carry on). sinceLast is since the last check by ANY admin tab (Bell shares it).
 */
export const BG_MS = 60_000;
export const BG_MAX = 10 * 3600_000;
export function backgroundAlerts(live: boolean, sinceLast: number, idle: number, perm: string | null) {
  return live && perm === "granted" && sinceLast >= BG_MS - 5_000 && idle < BG_MAX;
}

/** Test hook: pretend the last activity was at `at`. */
export function _setLastActivity(at: number) {
  last = at;
}
