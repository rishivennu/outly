"use client";

/**
 * R1184: the short chime for new Live Assist requests (admin bell and the Live Assist console). Made with Web
 * Audio, so there is no sound file to load. On unless the specialist turns it off (stored per browser). Browsers
 * only allow sound after someone has clicked on the page, so a chime before that is skipped silently.
 */
const KEY = "outly-admin-live-sound";
export const SOUND_EVENT = "outly-live-sound";

export function soundOn() {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return false;
  }
}

export function setSound(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
  window.dispatchEvent(new CustomEvent(SOUND_EVENT, { detail: on }));
}

let ctx: AudioContext | null = null;
let last = 0;
const rung = new Set<string>();

/**
 * Two soft notes, at most once every 4 s however many requests arrive together. `keys` (session ids) make the
 * bell and the console agree: a request one of them already chimed for doesn't chime again in the other.
 */
export function chime(urgent = false, keys: string[] = []) {
  if (keys.length) {
    const fresh = keys.filter((k) => !rung.has(k));
    for (const k of fresh) rung.add(k);
    if (!fresh.length) return;
  }
  if (!soundOn() || typeof window === "undefined") return;
  const now = Date.now();
  if (now - last < 4000) return;
  last = now;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    if (ctx.state !== "running") return;
    const notes = urgent ? [880, 660, 880] : [660, 880];
    notes.forEach((f, i) => {
      const t = ctx!.currentTime + i * 0.16;
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(ctx!.destination);
      o.start(t);
      o.stop(t + 0.24);
    });
  } catch {}
}
