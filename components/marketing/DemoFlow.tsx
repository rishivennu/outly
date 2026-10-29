"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Check, Info, Pause, Play, RefreshCw } from "lucide-react";
import { AppIcon } from "@/components/brand/brands";
import { OutlyMark } from "@/components/brand/Logo";
import { cn } from "@/lib/utils";
import { Bars, Bolt } from "./bento/Art";
import { Reveal } from "./Reveal";

/*
 * Demo on the shared bento (10-15e), the same tile system as Platforms: every tile is a glowing
 * picture, a title and one grey line. The tile for the step that is playing lights up; the one lime
 * tile carries the step in two words and the step dots. Nothing here talks to a server. Four beats
 * loop; the last deliberately shows a failure, because that is the state the product is designed around.
 * React re-renders only on beat changes; everything in between is CSS on the compositor.
 */

type Beat = 0 | 1 | 2 | 3;
const BEAT_MS = 2500;
const ORDER = ["instagram", "youtube", "x"] as const;
type Core = (typeof ORDER)[number];
const COUNT = ["None", "One", "Two", "Three"];
const NAME: Record<Core, string> = { instagram: "Instagram", youtube: "YouTube", x: "X" };

const BEATS = [
  { label: "Upload", caption: "One file lands in your library. Every place waits for it." },
  { label: "Tailor", caption: "AI writes copy in each place's own shape: a caption, a title, a post." },
  { label: "Send", caption: "Each place becomes its own job, with its own progress." },
  { label: "Track", caption: "One is live, one is processing, one needs a hand. Retry only that one." },
] as const;

type Tone = "idle" | "work" | "done" | "fail";
type Retry = "idle" | "running" | "done";

function state(p: Core, beat: Beat, retry: Retry): { status: string; tone: Tone; note: string } {
  if (p === "x" && beat === 3 && retry !== "idle")
    return retry === "running" ? { status: "retrying", tone: "work", note: "Sending a trimmed version." } : { status: "live", tone: "done", note: "Live, with a link to the post." };
  if (beat === 0) return { status: "waiting", tone: "idle", note: "Waiting for the upload to finish." };
  if (beat === 1) return { status: "draft ready", tone: "idle", note: "Draft ready. Edit it before anything is sent." };
  if (beat === 2) return { status: p === "youtube" ? "queued" : "uploading", tone: "work", note: "Uploading the video." };
  if (p === "instagram") return { status: "live", tone: "done", note: "Live, with a link to the post." };
  if (p === "youtube") return { status: "processing", tone: "work", note: "Still processing. We keep checking." };
  return { status: "needs a hand", tone: "fail", note: "X said the file is too long." };
}

/** The two words on the lime tile: what the beat amounts to. */
function headline(beat: Beat, done: number) {
  if (beat === 0) return ["One", "upload."];
  if (beat === 1) return ["Three", "drafts."];
  if (beat === 2) return ["Three", "sends."];
  return [COUNT[done], "live."];
}

export function DemoFlow() {
  const uid = useId().replace(/:/g, "");
  const root = useRef<HTMLDivElement>(null);
  const [beat, setBeat] = useState<Beat>(0);
  const [retry, setRetry] = useState<Retry>("idle");
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [paused, setPaused] = useState(false);

  // Auto-play whenever the demo is on screen and the tab is visible. Only the Pause button stops it
  // (reduced motion still steps, the CSS just drops the movement).
  useEffect(() => {
    setMounted(true);
    const vis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", vis);
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.3 });
    if (root.current) io.observe(root.current);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      io.disconnect();
    };
  }, []);

  const running = mounted && visible && !hidden && !paused && retry !== "running";

  // Scroll-driven beats (ScrollScenes.tsx, wide screens): while the demo is pinned, the scroll position picks the step
  // and the beat clock waits. Scrolling past hands control back to the clock. The tabs still work throughout.
  const [scrubbing, setScrubbing] = useState(false);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ beat: number; active: boolean }>).detail;
      setScrubbing(d.active);
      if (d.active) setBeat(Math.max(0, Math.min(3, d.beat)) as Beat);
    };
    el.addEventListener("demo:scrub", on);
    return () => el.removeEventListener("demo:scrub", on);
  }, []);
  const clock = running && !scrubbing;

  // Pausable beat clock: pausing keeps the time already spent.
  const remaining = useRef(BEAT_MS);
  const shownBeat = useRef<Beat>(0);
  useEffect(() => {
    if (shownBeat.current !== beat) {
      shownBeat.current = beat;
      remaining.current = BEAT_MS;
    }
    if (!clock) return;
    const start = performance.now();
    const t = window.setTimeout(() => setBeat((b) => ((b + 1) % 4) as Beat), Math.max(0, remaining.current));
    return () => {
      window.clearTimeout(t);
      remaining.current -= performance.now() - start;
    };
  }, [beat, clock]);

  useEffect(() => setRetry("idle"), [beat]);
  useEffect(() => {
    if (retry !== "running") return;
    const t = window.setTimeout(() => setRetry("done"), 1500);
    return () => window.clearTimeout(t);
  }, [retry]);

  const go = useCallback((b: Beat) => setBeat(b), []);
  const states = ORDER.map((p) => state(p, beat, retry));
  const done = states.filter((s) => s.tone === "done").length;
  const [w1, w2] = headline(beat, done);

  return (
    <div
      ref={root}
      className="dark demo-stage mx-auto w-full max-w-[1180px]"
      data-beat={beat}
      data-running={running ? "" : undefined}
      data-scrub={scrubbing ? "" : undefined}
      style={{ ["--beat" as string]: `${BEAT_MS}ms` }}
    >
      <div className="bx-head">
        <div className="min-w-0">
          <h2 id="demo-title" className="display mt-3 text-balance">
            Watch one upload become <span className="accent-serif bx-accent">three posts.</span>
          </h2>
          <p className="bx-lead">Including the part where a platform says no.</p>
        </div>
        <p className="bx-note">
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
          Illustration, not live data.
        </p>
      </div>

      {/* 10-16f: three tiles for the story (upload, drafts, the step), then one Live Activity card per place.
          The per-place tiles (sends, status, fix, live count) live in those cards now. */}
      <Reveal y={0} fx="tiles" className="bx bx-demo">
        <Tile tone="send" on={beat === 0} live={beat === 0 && running} title="One upload" sub="desk-setup.mp4 lands in your library." art={<Bars />} meta={["Format|MP4 1080p", "Length|0:42", "Size|18 MB", "Audio|Stereo"]} />
        <Tile tone="wait" on={beat === 1} title="Three drafts" sub="A caption, a title and a post, each in its own shape." art={<Bolt id={`${uid}-bolt`} />} />
        <div className="bx-tile bx-lime">
          <div className="flex items-center justify-between">
            <Steps beat={beat} go={go} uid={uid} />
            <button type="button" className="bx-play" onClick={() => setPaused((v) => !v)} aria-label={paused ? "Play demo" : "Pause demo"}>
              {paused ? <Play className="ml-0.5 h-4 w-4 fill-current" aria-hidden="true" /> : <Pause className="h-4 w-4 fill-current" aria-hidden="true" />}
            </button>
          </div>
          <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${beat}`} aria-live="polite" className="bx-copy mt-auto pt-8">
            <p className="text-[13px] font-semibold">
              Step <span className="tabular">{beat + 1}</span> of 4 · {BEATS[beat].label}
            </p>
            <p key={`w-${beat}-${done}`} className="bx-word bx-big mt-2">
              {w1} <span className="accent-serif font-normal">{w2}</span>
            </p>
            <p key={`c-${beat}`} className="bx-word bx-sub">{BEATS[beat].caption}</p>
          </div>
        </div>
      </Reveal>

      {/* The same Live Activity cards the posting screen uses, playing the demo's beats (10-16f). */}
      <ul aria-label="Each place, live" className="la-demo mt-3 flex flex-wrap gap-3">
        {ORDER.map((p, i) => (
          <DemoActivity key={p} p={p} s={states[i]} beat={beat} retry={retry} moving={running} onRetry={() => setRetry("running")} />
        ))}
      </ul>
    </div>
  );
}

const CODE: Record<Core, string> = { instagram: "IG", youtube: "YT", x: "X" };
const FORMAT: Record<Core, string> = { instagram: "Reel", youtube: "Short", x: "Post" };
const TITLE: Record<string, string> = { waiting: "Waiting", "draft ready": "Draft ready", queued: "Queued", uploading: "Sending", processing: "Going public", retrying: "Trying again", live: "Live", "needs a hand": "Needs a hand" };
const STEP: Record<string, number> = { waiting: 1, "draft ready": 1, queued: 1, uploading: 2, retrying: 2, processing: 3, live: 4 };

function pctFor(p: Core, status: string, beat: Beat) {
  if (status === "live") return 100;
  if (status === "processing") return 78;
  if (status === "retrying") return 60;
  if (status === "needs a hand") return 46;
  if (beat === 2) return p === "youtube" ? 12 : p === "instagram" ? 44 : 36;
  return 0;
}

/** One Live Activity card, demo flavour: no server, the beat clock drives it. */
function DemoActivity({ p, s, beat, retry, moving, onRetry }: { p: Core; s: { status: string; tone: Tone; note: string }; beat: Beat; retry: Retry; moving: boolean; onRetry: () => void }) {
  const live = s.tone === "done";
  const bad = s.tone === "fail";
  const work = s.tone === "work";
  const pct = pctFor(p, s.status, beat);
  const step = STEP[s.status] ?? 1;
  const accent = live ? "Live now" : bad ? "Tap retry to finish" : s.status === "retrying" ? "Try 2" : `Step ${step} of 4`;
  return (
    <li className={cn("la-card la-themed relative flex min-w-0 flex-[1_1_17rem] flex-col overflow-hidden rounded-[2rem] p-4 sm:p-5", live && "la-live", bad && "la-bad")}>
      <div className="relative flex items-center gap-3">
        <span className="la-code text-[13px] font-semibold tracking-tight" aria-hidden="true">YOU</span>
        <ArrowRight className="la-arrow h-6 w-6 shrink-0" strokeWidth={3} aria-hidden="true" />
        <span className="la-code text-[13px] font-semibold tracking-tight" aria-hidden="true">{CODE[p]}</span>
        <h3 className="ml-auto min-w-0 truncate text-[15px] font-semibold leading-tight">{NAME[p]}</h3>
      </div>
      <div className="relative mt-3 grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <p className="font-semibold leading-tight">Your video</p>
          <p className="mt-1 truncate text-[11px] font-medium la-mute">desk-setup.mp4</p>
        </div>
        <div className="min-w-0">
          <p className="font-semibold leading-tight">Goes out as</p>
          <p className="mt-1 truncate text-[11px] font-medium la-mute">{FORMAT[p]}</p>
        </div>
      </div>

      <div className="la-box relative mt-4 flex min-h-[7.75rem] flex-col justify-center rounded-[1.25rem] p-4 pr-16">
        <p key={s.status} className="bx-word text-lg font-semibold leading-tight">{TITLE[s.status] ?? s.status}</p>
        <p className="mt-1 text-sm leading-snug la-mute">{s.note}</p>
        <p className={cn("mt-2 text-[11.5px] font-semibold", bad ? "la-warn" : "la-accent")}>{accent}</p>
        <span className="absolute right-3 top-3">
          {bad ? (
            <button type="button" onClick={onRetry} disabled={retry === "running"} className="la-round" aria-label={`Try again on ${NAME[p]}`}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : live ? (
            <span className="la-round" aria-hidden="true">
              <Check className="h-4 w-4" strokeWidth={3} />
            </span>
          ) : (
            <span className="grid h-11 w-11 place-items-center" aria-hidden="true">
              <AppIcon brand={p} size={30} />
            </span>
          )}
        </span>
      </div>

      <div
        className="la-track relative mt-4 h-14 rounded-full"
        role="progressbar"
        aria-label={`${NAME[p]} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${NAME[p]}: ${TITLE[s.status] ?? s.status}`}
      >
        <div className={cn("la-fill absolute inset-0 rounded-full", work && moving && "la-fill-anim")} style={{ ["--p" as string]: `max(3.5rem, ${pct}%)` }}>
          {live && <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-[hsl(var(--lime-foreground))]">Landed</span>}
        </div>
        <span className="la-rider" style={{ ["--p" as string]: `max(3.5rem, ${pct}%)` }} aria-hidden="true">
          <span className="absolute right-1.5 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center">
            <OutlyMark variant="ink" size={26} className={cn("la-rocket", work && moving && "la-rocket-anim")} />
          </span>
        </span>
        {!live && <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs font-semibold tabular-nums la-mute">{bad ? "STOPPED" : `${pct}%`}</span>}
      </div>
    </li>
  );
}

type GTone = "wait" | "send" | "live" | "bad";

/** The bottom glow and rim of the gradient cards. Decorative only. */
function Glow() {
  return (
    <>
      <span className="gc-glow" aria-hidden="true" />
      <span className="gc-rim" aria-hidden="true" />
    </>
  );
}

function Tile({ tone, on, live, title, sub, art, meta }: { tone: GTone; on: boolean; live?: boolean; title: string; sub: string; art: React.ReactNode; meta?: string[] }) {
  return (
    <div className={cn("bx-tile bx-gc", `gc-${tone}`, on && "is-on", live && "bx-live")}>
      <Glow />
      <div className="bx-art">{art}</div>
      <div className="bx-copy">
        <h3 className="bx-title">{title}</h3>
        <p className="bx-sub">{sub}</p>
        {meta && (
          <dl className="bx-meta">
            {meta.map((m) => {
              const [k, v] = m.split("|");
              return (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              );
            })}
          </dl>
        )}
      </div>
    </div>
  );
}

/** The step dots, a real tablist: roving tabindex, arrow keys, Home and End. */
function Steps({ beat, go, uid }: { beat: Beat; go: (b: Beat) => void; uid: string }) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const key = (e: React.KeyboardEvent) => {
    const to = e.key === "ArrowRight" ? (beat + 1) % 4 : e.key === "ArrowLeft" ? (beat + 3) % 4 : e.key === "Home" ? 0 : e.key === "End" ? 3 : -1;
    if (to < 0) return;
    e.preventDefault();
    go(to as Beat);
    tabs.current[to]?.focus();
  };
  return (
    <div role="tablist" aria-label="Demo steps" className="bx-dots -ml-2" onKeyDown={key}>
      {BEATS.map((b, i) => (
        <button
          key={b.label}
          ref={(el) => {
            tabs.current[i] = el;
          }}
          id={`${uid}-tab-${i}`}
          type="button"
          role="tab"
          aria-selected={beat === i}
          aria-controls={`${uid}-panel`}
          aria-label={`Step ${i + 1}: ${b.label}`}
          tabIndex={beat === i ? 0 : -1}
          className="bx-dot"
          onClick={() => go(i as Beat)}
        >
          <i />
        </button>
      ))}
    </div>
  );
}
