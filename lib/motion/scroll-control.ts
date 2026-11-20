/**
 * R1262: how fast the page may glide under a wheel or trackpad (Lenis, components/marketing/SmoothScroll.tsx).
 * Pure numbers, no DOM, so it is unit-tested (tests/round-1262-scroll-control.test.ts).
 *
 * Lenis adds every wheel delta to its target and restarts the glide (SMOOTH: expo.out over `duration`) from where the
 * page is painted towards that target. Two limits keep a hard flick from racing through whole sections:
 *  - each wheel event moves the target at most `maxWheelDelta` px (a mouse notch is ~100-120 px and passes whole);
 *  - the target never runs more than `ahead` px in front of the painted position,
 *    ahead = clamp(viewportH * maxAheadVh, minAhead, maxAhead).
 * Max velocity: expo.out starts at slope 10 * ln 2 (~6.93), and a held wheel restarts the glide every event with the
 * target `ahead` px away, so the page tops out at ~6.93 * ahead / SMOOTH.duration px/s (800 px screen: 480 px ahead,
 * ~3330 px/s; 1080 px: 648 px ahead, ~4490 px/s; both ~4.2 screens a second). One flick that stops is done in about
 * `ahead / SMOOTH.duration` px/s on average.
 */
export const SCROLL = {
  maxWheelDelta: 160,
  maxAheadVh: 0.6,
  minAhead: 360,
  maxAhead: 900,
  /** A capped wheel event still moves the target this much, so Lenis keeps owning (and cancelling) the event. */
  hold: 0.001,
} as const;

export type ScrollConfig = { maxWheelDelta: number; maxAheadVh: number; minAhead: number; maxAhead: number; hold: number };

const finite = (n: number) => (Number.isFinite(n) ? n : 0);

export function clampDelta(delta: number, max: number): number {
  const d = finite(delta);
  const m = Math.abs(finite(max));
  return Math.min(Math.max(d, -m), m);
}

/** `ahead` = targetScroll - animatedScroll (signed). Never blocks a delta that reduces |ahead| (reversing). */
export function capAhead(delta: number, ahead: number, maxAhead: number): number {
  const d = finite(delta);
  const a = finite(ahead);
  const m = Math.abs(finite(maxAhead));
  if (d === 0 || Math.abs(a + d) <= Math.abs(a)) return d;
  if (d > 0) return Math.max(0, Math.min(d, m - a));
  return Math.min(0, Math.max(d, -m - a));
}

export const aheadLimit = (viewportH: number, cfg: ScrollConfig = SCROLL) =>
  Math.min(Math.max(finite(viewportH) * cfg.maxAheadVh, cfg.minAhead), cfg.maxAhead);

export function controlWheel(deltaY: number, ahead: number, viewportH: number, cfg: ScrollConfig = SCROLL): number {
  return capAhead(clampDelta(deltaY, cfg.maxWheelDelta), ahead, aheadLimit(viewportH, cfg));
}

/**
 * The delta handed back to Lenis. A capped event becomes a tiny step in the same direction instead of 0: Lenis treats
 * a 0 delta as "no gesture" and lets the browser scroll natively, which would skip the cap.
 */
export function wheelDelta(deltaY: number, ahead: number, viewportH: number, cfg: ScrollConfig = SCROLL): number {
  const raw = finite(deltaY);
  const d = controlWheel(raw, ahead, viewportH, cfg);
  return d === 0 && raw !== 0 ? Math.sign(raw) * cfg.hold : d;
}
