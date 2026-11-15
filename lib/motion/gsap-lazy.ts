import type Gsap from "gsap";

export type GsapApi = typeof Gsap;

/*
 * GSAP for the studio, loaded on demand instead of with the first page (about 45 KB the studio's first paint and
 * hydration never needed: its route entrances only play on a later navigation). RouteStage asks for it once the
 * browser is idle; a motion that runs before it has landed simply shows its final state.
 */
let mod: GsapApi | null = null;
let loading: Promise<GsapApi> | null = null;

export const gsapNow = () => mod;

export function loadGsap(): Promise<GsapApi> {
  loading ??= import("gsap")
    .then((m) => (mod = m.gsap))
    .catch((err) => {
      loading = null;
      throw err;
    });
  return loading;
}
