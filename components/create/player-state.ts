import { useEffect, type RefObject } from "react";

/* Pure player rules for the Create preview, kept out of the component so they are unit tested. */

export type PlayerPrefs = { volume: number; muted: boolean };
export const PLAYER_PREFS_KEY = "outlly.player.v1";
export const DEFAULT_PREFS: PlayerPrefs = { volume: 1, muted: false };
export const VOLUME_STEP = 0.1;

export const clampVolume = (v: number) => (Number.isFinite(v) ? Math.round(Math.max(0, Math.min(1, v)) * 100) / 100 : 1);

export function readPrefs(raw: string | null | undefined): PlayerPrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const j = JSON.parse(raw) as Partial<PlayerPrefs>;
    return { volume: typeof j.volume === "number" ? clampVolume(j.volume) : 1, muted: j.muted === true };
  } catch {
    return DEFAULT_PREFS;
  }
}

export const writePrefs = (p: PlayerPrefs) => JSON.stringify({ volume: clampVolume(p.volume), muted: !!p.muted });

/** Dragging the slider to 0 is a mute; raising it from a mute unmutes. The speaker icon follows what you hear. */
export function setVolume(v: number): PlayerPrefs {
  const volume = clampVolume(v);
  return { volume, muted: volume === 0 };
}

/** Unmuting from 0 would still be silent, so it comes back at a sensible level. */
export function toggleMute(p: PlayerPrefs): PlayerPrefs {
  if (p.muted || p.volume === 0) return { muted: false, volume: p.volume === 0 ? 0.5 : p.volume };
  return { ...p, muted: true };
}

export const audible = (p: PlayerPrefs) => !p.muted && p.volume > 0;

/**
 * iOS Safari keeps media volume under the hardware buttons: setting it does nothing and reading it gives 1.
 * There the player offers mute only, instead of a slider that silently does nothing.
 */
export function canSetVolume(el: { volume: number }): boolean {
  const before = el.volume;
  try {
    const probe = before === 0.5 ? 0.4 : 0.5;
    el.volume = probe;
    const ok = Math.abs(el.volume - probe) < 0.01;
    el.volume = before;
    return ok;
  } catch {
    return false;
  }
}

/**
 * Without a poster some browsers (iOS Safari above all) paint nothing until the first seek, which reads as a
 * black, broken video. Seeking a hair past 0 makes them decode and show the first frame. Only when idle at 0.
 */
export const FIRST_FRAME = 0.001;
export const needsFirstFrame = (el: { currentTime: number; paused: boolean }, hasPoster: boolean) => !hasPoster && el.paused && el.currentTime === 0;

type Media = { paused: boolean; pause: () => void; play: () => Promise<void> | void };
export type PlayerRole = "main" | "ambient";

/**
 * Only one video plays at a time. The editor's player is "main": when it plays, every other video pauses.
 * Platform previews are "ambient" muted loops: they only play while no main player is playing.
 */
export function createPlayback() {
  const players = new Map<Media, PlayerRole>();
  const listeners = new Set<() => void>();
  let playing: Media | null = null;
  const notify = () => listeners.forEach((f) => f());
  return {
    register(el: Media, role: PlayerRole) {
      players.set(el, role);
      return () => {
        players.delete(el);
        if (playing === el) {
          playing = null;
          notify();
        }
      };
    },
    /** Call from the element's play event. Returns false when the play was refused (and paused). */
    played(el: Media): boolean {
      const role = players.get(el);
      if (role === "main") {
        for (const [o] of players) if (o !== el && !o.paused) o.pause();
        if (playing !== el) {
          playing = el;
          notify();
        }
        return true;
      }
      if (playing && !playing.paused) {
        el.pause();
        return false;
      }
      return true;
    },
    stopped(el: Media) {
      if (playing !== el) return;
      playing = null;
      notify();
    },
    mainPlaying: () => !!playing && !playing.paused,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    size: () => players.size,
  };
}

export const playback = createPlayback();

/** Registers a video element with the page's one-at-a-time rule for as long as it is mounted. */
export function usePlayback(ref: RefObject<HTMLVideoElement | null>, role: PlayerRole, src: string | null) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const off = playback.register(el, role);
    const onPlay = () => playback.played(el);
    const onStop = () => playback.stopped(el);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onStop);
    el.addEventListener("ended", onStop);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onStop);
      el.removeEventListener("ended", onStop);
      off();
    };
  }, [ref, role, src]);
}
