"use client";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { Music, VolumeX } from "lucide-react";
import { Pip } from "@/components/brand/Pip";
import { cn } from "@/lib/utils";

/**
 * Pip's groove: one shared lofi track that plays while a video uploads or sends, and a Pip that
 * dances to its actual beat (Web Audio analyser on the bass band). One <audio> for the whole app,
 * so moving from "uploading" to "sending" doesn't restart the song.
 *
 * - Starts when any useGroove(true) mounts, fades out when the last one goes quiet.
 * - The Music toggle is remembered (localStorage). Autoplay blocked -> the toggle starts it.
 * - Pauses itself while the creator plays their own video with sound, so nothing clashes.
 * - Reduced motion: Pip stays put (CSS), the music still plays.
 */
const SRC = "/audio/pip-groove.mp3";
const KEY = "outlly:groove";
const VOL = 0.35;

type Snap = { on: boolean; playing: boolean; blocked: boolean };
let snap: Snap = { on: true, playing: false, blocked: false };
const subs = new Set<() => void>();
const set = (p: Partial<Snap>) => {
  snap = { ...snap, ...p };
  subs.forEach((f) => f());
};

let audio: HTMLAudioElement | null = null;
let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let bins: Uint8Array | null = null;
let users = 0;
let held = false; // the creator's own video is playing with sound
let fade: ReturnType<typeof setInterval> | null = null;
let raf = 0;
const dancers = new Set<HTMLElement>();
let inited = false;

function init() {
  if (inited || typeof window === "undefined") return;
  inited = true;
  try {
    if (localStorage.getItem(KEY) === "off") snap = { ...snap, on: false };
  } catch {}
  // Any <video> playing with sound holds the groove; pausing/muting it lets the groove back in.
  const check = () => {
    const loud = [...document.querySelectorAll("video")].some((v) => !v.paused && !v.muted && v.volume > 0);
    if (loud !== held) {
      held = loud;
      sync();
    }
  };
  for (const ev of ["play", "pause", "ended", "volumechange"]) document.addEventListener(ev, (e) => e.target instanceof HTMLVideoElement && check(), true);
}

function ramp(to: number, then?: () => void) {
  if (!audio) return;
  if (fade) clearInterval(fade);
  const a = audio;
  const step = (to - a.volume) / 12;
  fade = setInterval(() => {
    const v = a.volume + step;
    if ((step >= 0 && v >= to) || (step < 0 && v <= to) || step === 0) {
      a.volume = Math.max(0, Math.min(1, to));
      if (fade) clearInterval(fade);
      fade = null;
      then?.();
    } else a.volume = Math.max(0, Math.min(1, v));
  }, 40);
}

function wire() {
  if (!audio) {
    audio = new Audio(SRC);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 0;
  }
  if (!ctx) {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        ctx = new AC();
        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.6;
        bins = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
        ctx.createMediaElementSource(audio).connect(analyser);
        analyser.connect(ctx.destination);
      }
    } catch {
      analyser = null; // still plays; Pip falls back to a steady groove
    }
  }
}

function sync() {
  init();
  const want = users > 0 && snap.on && !held;
  if (want) {
    wire();
    if (!audio) return;
    void ctx?.resume().catch(() => {});
    if (audio.paused)
      audio
        .play()
        .then(() => {
          set({ playing: true, blocked: false });
          ramp(VOL);
          loop();
        })
        .catch(() => set({ playing: false, blocked: true }));
    else ramp(VOL);
  } else if (audio && !audio.paused) {
    const a = audio;
    ramp(0, () => {
      if (!(users > 0 && snap.on && !held)) {
        a.pause();
        set({ playing: false });
        if (users === 0) a.currentTime = 0;
      }
    });
  }
}

/* Beat follower: bass energy against its own running average. Writes CSS vars on every dancer. */
let avg = 0;
let last = 0;
let side = 1;
let kick = 0;
function loop() {
  cancelAnimationFrame(raf);
  const tick = (t: number) => {
    let lvl = 0;
    if (analyser && bins && snap.playing) {
      analyser.getByteFrequencyData(bins);
      let e = 0;
      for (let i = 1; i < 7; i++) e += bins[i];
      e /= 6;
      avg = avg ? avg * 0.94 + e * 0.06 : e;
      lvl = Math.min(1, e / 255);
      if (e > avg * 1.18 && e > 70 && t - last > 260) {
        last = t;
        side = -side;
        kick = 1;
      }
    }
    kick *= 0.86;
    const fallback = !analyser || !snap.playing;
    for (const el of dancers) {
      el.style.setProperty("--g-lvl", lvl.toFixed(3));
      el.style.setProperty("--g-kick", kick.toFixed(3));
      el.style.setProperty("--g-side", String(side));
      el.classList.toggle("groove-auto", fallback);
    }
    if (dancers.size || snap.playing) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

export function useGroove(active: boolean) {
  const s = useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => snap,
    () => snap,
  );
  useEffect(() => {
    init();
    set({});
    if (!active) return;
    users++;
    sync();
    return () => {
      users--;
      sync();
    };
  }, [active]);
  const toggle = useCallback(() => {
    // A click is a user gesture, so this is also how a blocked autoplay gets going.
    const on = snap.blocked && snap.on ? true : !snap.on;
    try {
      localStorage.setItem(KEY, on ? "on" : "off");
    } catch {}
    set({ on, blocked: false });
    sync();
  }, []);
  return { ...s, toggle };
}

/** Pip dancing. The beat drives CSS vars on the wrapper; with no audio he keeps a gentle 90 BPM bounce. */
export function DancingPip({ size = 72, className }: { size?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    dancers.add(el);
    el.classList.add("groove-auto");
    loop();
    return () => {
      dancers.delete(el);
    };
  }, []);
  return (
    <span ref={ref} className={cn("groove relative inline-block", className)} aria-hidden="true">
      <span className="groove-body inline-block">
        <Pip size={size} mood="happy" />
      </span>
      <svg className="groove-note groove-note-a" viewBox="0 0 24 24" width={size * 0.22} height={size * 0.22}>
        <path d="M9 18a3 3 0 1 1-2-2.83V5l12-2v11.5a3 3 0 1 1-2-2.83V6.3L9 7.7Z" fill="currentColor" />
      </svg>
      <svg className="groove-note groove-note-b" viewBox="0 0 24 24" width={size * 0.18} height={size * 0.18}>
        <path d="M12 3v11.2A3.5 3.5 0 1 0 14 17V7h5V3Z" fill="currentColor" />
      </svg>
    </span>
  );
}

/** The music switch. 44px, labelled, remembers the choice. `tone` picks colours for dark glass vs page. */
export function MusicToggle({ g, tone = "page", iconOnly, className }: { g: ReturnType<typeof useGroove>; tone?: "page" | "glass"; iconOnly?: boolean; className?: string }) {
  const sounding = g.on && g.playing;
  const label = g.blocked ? "Play music" : g.on ? "Music on" : "Music off";
  return (
    <button
      type="button"
      onClick={g.toggle}
      aria-pressed={g.on && !g.blocked}
      aria-label={g.blocked ? "Play music" : g.on ? "Turn music off" : "Turn music on"}
      className={cn(
        "inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2",
        tone === "glass" ? "text-white/85 hover:bg-white/15 hover:text-white focus-visible:ring-white/70" : "bg-card text-foreground hairline hover:bg-secondary focus-visible:ring-ring",
        className,
      )}
    >
      {g.on && !g.blocked ? <Music className={cn("h-4 w-4", sounding && "groove-eq")} aria-hidden="true" /> : <VolumeX className="h-4 w-4" aria-hidden="true" />}
      <span className={iconOnly ? "sr-only" : tone === "glass" ? "sr-only sm:not-sr-only" : undefined}>{label}</span>
    </button>
  );
}
