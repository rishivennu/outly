/** Motion preferences, read by the GSAP engines (reveal.ts, route.ts) without loading GSAP itself. */

/** Animations only run inside this query; reduced-motion users get the final state, no tweening. */
export const MOTION_OK = "(prefers-reduced-motion: no-preference)";

export const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
// Phones: a short lift and fade only. Big slides while the finger is still scrolling cost frames on low-end devices.
const coarse = () => typeof matchMedia !== "undefined" && matchMedia("(hover: none) and (pointer: coarse)").matches;
let weak: boolean | null = null;
/** Low-power hint: Save-Data, or a small machine (few cores and little memory). Cached, it never changes mid-visit. */
const lowPower = () => {
  if (weak !== null) return weak;
  const n = (typeof navigator !== "undefined" ? navigator : {}) as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  weak = !!n.connection?.saveData || ((n.hardwareConcurrency ?? 8) <= 4 && (n.deviceMemory ?? 8) <= 4);
  return weak;
};
export const simple = () => coarse() || lowPower();
