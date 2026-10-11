"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, Info, Play, RotateCcw, Sparkles } from "lucide-react";
import { OutlyMark } from "@/components/brand/Logo";
import { PlatformGlyph } from "@/components/shared/PlatformIcon";
import { cn } from "@/lib/utils";
import type { Platform } from "@/lib/domain";

/*
 * v4 "postage": a mock of the real create -> publish flow. Each destination is a stamp;
 * the result of each job is the postmark it gets.
 * Nothing here talks to a server. Four beats loop; the last deliberately shows a failure,
 * because that is the state the product is designed around.
 *
 * Motion budget: React re-renders only on beat changes. Everything in between is CSS
 * transforms, opacity and clip-path on the compositor.
 */

type Beat = 0 | 1 | 2 | 3;
const BEAT_MS = 4200;
const ORDER: Platform[] = ["instagram", "youtube", "x"];

const BEATS = [
  { label: "Upload", caption: "One file lands in your library. Every destination waits for it." },
  { label: "Tailor", caption: "AI writes copy in each platform's own shape: a caption, a title, a post." },
  { label: "Send", caption: "Each destination becomes its own job, with its own progress." },
  { label: "Track", caption: "One is live, one is still processing, one needs a hand. Retry only that one." },
] as const;

const COPY: Record<Platform, { name: string; format: string; field: string; text: string; tags?: string }> = {
  instagram: { name: "Instagram", format: "Reel", field: "Caption", text: "I rebuilt my whole desk setup in a weekend. Here's the one change that did it.", tags: "#desksetup #workspace" },
  youtube: { name: "YouTube", format: "Short", field: "Title", text: "The one desk change that fixed my workflow" },
  x: { name: "X", format: "Post", field: "Post", text: "Spent a weekend on my desk. One change did 90% of the work:" },
};

type Tone = "idle" | "work" | "done" | "fail";
type Retry = "idle" | "running" | "done";

function state(p: Platform, beat: Beat, retry: Retry): { status: string; tone: Tone; fill: number; note: string } {
  if (p === "x" && beat === 3 && retry !== "idle")
    return retry === "running"
      ? { status: "Retrying", tone: "work", fill: 1, note: "Sending a trimmed version." }
      : { status: "Published", tone: "done", fill: 1, note: "Live, with a link to the post." };
  if (beat === 0) return { status: "Waiting for file", tone: "idle", fill: 0, note: "Starts once the upload finishes." };
  if (beat === 1) return { status: "Draft ready", tone: "idle", fill: 0, note: "You can edit it before anything is sent." };
  if (beat === 2) return { status: p === "youtube" ? "Queued" : "Uploading", tone: "work", fill: p === "instagram" ? 0.78 : p === "youtube" ? 0.36 : 0.55, note: p === "youtube" ? "Next in line." : "Sending the video." };
  if (p === "instagram") return { status: "Published", tone: "done", fill: 1, note: "Live, with a link to the post." };
  if (p === "youtube") return { status: "Processing", tone: "work", fill: 0.92, note: "YouTube is still processing. We keep checking." };
  return { status: "Media rejected", tone: "fail", fill: 0.6, note: "X said the file is too long for this account tier." };
}

const TONE_TEXT: Record<Tone, string> = { idle: "text-muted-foreground", work: "text-accent", done: "text-success", fail: "text-destructive" };

export function DemoFlow() {
  const uid = useId();
  const root = useRef<HTMLDivElement>(null);
  const [beat, setBeat] = useState<Beat>(0);
  const [retry, setRetry] = useState<Retry>("idle");
  const [reduced, setReduced] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [hover, setHover] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      setReduced(mq.matches);
      if (mq.matches) setBeat(3);
    };
    apply();
    mq.addEventListener("change", apply);
    const vis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", vis);
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.3 });
    if (root.current) io.observe(root.current);
    return () => {
      mq.removeEventListener("change", apply);
      document.removeEventListener("visibilitychange", vis);
      io.disconnect();
    };
  }, []);

  const running = mounted && !reduced && visible && !hover && !hidden && retry !== "running";

  // Pausable beat clock: pausing keeps the time already spent, so the step timer and the beat agree.
  const remaining = useRef(BEAT_MS);
  const shownBeat = useRef<Beat>(0);
  useEffect(() => {
    if (shownBeat.current !== beat) {
      shownBeat.current = beat;
      remaining.current = BEAT_MS;
    }
    if (!running) return;
    const start = performance.now();
    const t = window.setTimeout(() => setBeat((b) => ((b + 1) % 4) as Beat), Math.max(0, remaining.current));
    return () => {
      window.clearTimeout(t);
      remaining.current -= performance.now() - start;
    };
  }, [beat, running]);

  useEffect(() => setRetry("idle"), [beat]);
  useEffect(() => {
    if (retry !== "running") return;
    const t = window.setTimeout(() => setRetry("done"), 1500);
    return () => window.clearTimeout(t);
  }, [retry]);

  const go = useCallback((b: Beat) => setBeat(b), []);
  const done = ORDER.filter((p) => state(p, beat, retry).tone === "done").length;

  return (
    <div
      ref={root}
      className="mx-auto w-full max-w-[1040px]"
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={() => setHover(false)}
      data-beat={beat}
      data-running={running ? "" : undefined}
    >
      <div className="demo-card relative isolate overflow-hidden rounded-[32px] bg-card hairline">
        <div className="demo-aura" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        {/* composer bar: the one file everything comes from */}
        <div className="relative flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border/70 px-4 py-3.5 sm:px-6">
          <OutlyMark size={20} />
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="demo-video relative h-11 w-8 shrink-0 overflow-hidden rounded-[8px]" aria-hidden="true">
              <span className="demo-video-sheen" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <p className="truncate text-sm font-medium">desk-setup.mp4</p>
                <p className="hidden shrink-0 text-xs text-muted-foreground tabular sm:block">0:28 · 1080p · 42 MB</p>
              </div>
              <div className="mt-1.5 h-1.5 max-w-[260px] overflow-hidden rounded-full bg-secondary" aria-hidden="true">
                <span key={beat === 0 ? "up-0" : "up-done"} className={cn("demo-upload block h-full origin-left rounded-full bg-lime", beat === 0 ? "is-filling" : "is-full")} />
              </div>
            </div>
          </div>
          <span key={`s-${beat}-${retry}`} className={cn("demo-chip inline-flex min-h-[28px] items-center gap-1.5 rounded-full px-3 text-xs font-medium", beat === 1 ? "bg-lime/15 text-lime-ink dark:text-lime" : "bg-secondary text-muted-foreground")}>
            {beat === 0 && <><span className="demo-pulse h-1.5 w-1.5 rounded-full bg-muted-foreground" aria-hidden="true" /> Uploading</>}
            {beat === 1 && <><Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Tailoring 3 drafts</>}
            {beat === 2 && <><span className="demo-pulse h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" /> Sending to 3</>}
            {beat === 3 && <><Check className="h-3.5 w-3.5 text-success" aria-hidden="true" /> <span className="tabular">{done} of 3</span> live</>}
          </span>
        </div>

        {/* the three posts it becomes */}
        <ul className="demo-rail relative flex snap-x snap-mandatory gap-6 overflow-x-auto px-5 pb-6 pt-8 sm:px-8 md:grid md:grid-cols-3 md:gap-8 md:overflow-visible md:pt-10" aria-label="Destinations">
          {ORDER.map((p, i) => (
            <StampCard key={p} p={p} i={i} beat={beat} retry={retry} onRetry={() => setRetry("running")} />
          ))}
        </ul>
      </div>

      <Steps beat={beat} go={go} running={running} uid={uid} />

      <p id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${beat}`} aria-live="polite" className="mx-auto mt-4 max-w-md text-center text-sm text-muted-foreground">
        <span key={beat} className="demo-caption inline-block">{BEATS[beat].caption}</span>
      </p>
      <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground/80">
        <Info className="h-3 w-3" aria-hidden="true" />
        Illustration of the real flow, not live data.
      </p>
    </div>
  );
}

const STAMP: Record<Platform, { big: string; ratio: string; no: string; ink: string }> = {
  instagram: { big: "REELS", ratio: "9:16", no: "No.01", ink: "#b0186a" },
  youtube: { big: "SHORTS", ratio: "9:16", no: "No.02", ink: "#c4161c" },
  x: { big: "POST", ratio: "16:9", no: "No.03", ink: "#16161a" },
};

/**
 * One destination as a perforated postage stamp, printed in that platform's ink.
 * Beat 0: blank paper. 1: the ink prints in with the AI copy. 2: the stamp lifts and the
 * airmail meter runs. 3: a rubber postmark lands (or a red "return to sender").
 */
function StampCard({ p, i, beat, retry, onRetry }: { p: Platform; i: number; beat: Beat; retry: Retry; onRetry: () => void }) {
  const c = COPY[p];
  const st = STAMP[p];
  const s = state(p, beat, retry);
  const live = s.tone === "done";
  const mark = beat === 3 ? (live ? "posted" : s.tone === "fail" ? "returned" : "transit") : null;

  return (
    <li
      className={cn("stamp-item relative flex w-[80%] shrink-0 snap-center flex-col sm:w-[46%] md:w-auto", s.tone === "fail" && "is-fail", live && "is-done")}
      style={{ ["--i" as string]: i, ["--ink" as string]: st.ink, ["--tilt" as string]: `${[-2.2, 1.4, -1][i]}deg` }}
    >
      <div className="stamp-wrap">
        <div className={cn("stamp-perf", mark && "is-marked")} data-mark={mark ?? undefined}>
          <div className="stamp-face">
            {/* header band: big condensed name + the corner block, as on a real issue */}
            <div className="stamp-ink flex items-stretch gap-1.5">
              <p className="stamp-title flex-1">{st.big}</p>
              <div className="stamp-corner">
                <span className="flex gap-[3px]" aria-hidden="true">
                  <i /><i /><i />
                </span>
                <span className="tabular">{st.ratio}</span>
              </div>
            </div>

            {/* the vignette: the same desk video, duotoned in this platform's ink */}
            <div className="stamp-ink stamp-vignette relative mt-1.5 flex-1">
              <DeskScene />
              <span className="stamp-ai">
                <Sparkles className="h-3 w-3" aria-hidden="true" /> AI {c.field.toLowerCase()}
              </span>
              <span className="absolute inset-0 grid place-items-center" aria-hidden="true">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-[#f6f0e1]/90 text-[var(--ink)]">
                  <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
                </span>
              </span>
            </div>

            <p className={cn("stamp-ink stamp-copy mt-2", p === "youtube" && "font-bold")}>
              {c.text} {c.tags && <span className="opacity-70">{c.tags}</span>}
            </p>

            <div className="stamp-ink mt-2 flex items-center justify-between border-t-[1.5px] border-[var(--ink)] pt-1.5 text-[10px] font-bold uppercase tracking-[0.14em]">
              <span className="inline-flex items-center gap-1.5">
                <PlatformGlyph platform={p} className="h-3 w-3" /> {c.name} {c.format}
              </span>
              <span className="tabular">{st.no}</span>
            </div>

            {/* beat 0: un-inked paper */}
            <div className="stamp-blank" aria-hidden="true">
              <span /><span /><span />
            </div>
          </div>
        </div>
        {mark && <Postmark kind={mark} key={`${mark}-${retry}`} />}
      </div>

      {/* job status, on the page rather than on the stamp so it stays readable */}
      <div className="mt-4 px-1">
        <div className="flex min-h-[36px] items-center gap-2">
          {s.tone === "fail" ? (
            <>
              <span key="fail" className="demo-chip inline-flex items-center gap-1.5 text-xs font-semibold text-destructive">
                <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden="true" /> {s.status}
              </span>
              <button
                type="button"
                onClick={onRetry}
                className="demo-chip ml-auto inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-foreground px-3.5 text-xs font-semibold text-background transition-transform duration-200 hover:scale-[1.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-95"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Retry {c.name}
              </button>
            </>
          ) : (
            <span key={s.status} className={cn("demo-chip inline-flex items-center gap-1.5 text-xs font-semibold", TONE_TEXT[s.tone])}>
              {live ? (
                <span className="demo-tick grid h-5 w-5 place-items-center rounded-full bg-success/15">
                  <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                </span>
              ) : (
                <span className={cn("h-1.5 w-1.5 rounded-full", s.tone === "work" ? "demo-pulse bg-accent" : "bg-muted-foreground/60")} aria-hidden="true" />
              )}
              {s.status}
            </span>
          )}
        </div>
        <div className={cn("stamp-meter mt-2", s.tone === "work" && "is-work", live && "is-done", s.tone === "fail" && "is-fail")} aria-hidden="true">
          <span
            style={{
              transform: `scaleX(${beat >= 2 ? s.fill : 0})`,
              transitionDuration: beat === 2 ? `${BEAT_MS * 0.9}ms` : retry === "running" ? "1400ms" : "900ms",
            }}
          />
        </div>
        <p key={s.note} className="demo-chip mt-2 line-clamp-2 min-h-[32px] text-[12px] leading-4 text-muted-foreground">{s.note}</p>
      </div>
    </li>
  );
}

/** A tiny desk-setup illustration (monitor, lamp, plant) in paper colour, sitting on the ink. */
function DeskScene() {
  return (
    <svg viewBox="0 0 160 120" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <circle cx="122" cy="30" r="16" fill="#f6f0e1" opacity=".28" />
      <rect x="0" y="92" width="160" height="28" fill="#f6f0e1" opacity=".18" />
      <rect x="38" y="34" width="62" height="40" rx="4" fill="none" stroke="#f6f0e1" strokeWidth="3.5" />
      <rect x="44" y="40" width="50" height="28" rx="1.5" fill="#f6f0e1" opacity=".22" />
      <path d="M64 74v12M54 88h30" stroke="#f6f0e1" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M20 90V58l14-12" stroke="#f6f0e1" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M28 44l12 6-4 6z" fill="#f6f0e1" />
      <path d="M118 90c-6-10-2-22 6-26 6 6 8 18 2 26z" fill="#f6f0e1" opacity=".9" />
      <path d="M128 90c2-12 10-18 18-18-2 10-8 16-18 18z" fill="#f6f0e1" opacity=".7" />
      <rect x="114" y="88" width="20" height="8" rx="2" fill="#f6f0e1" />
      <path d="M0 96h160" stroke="#f6f0e1" strokeWidth="3" />
    </svg>
  );
}

/** Rubber postmarks. SVG so the ring text and the cancellation waves stay crisp at any size. */
function Postmark({ kind }: { kind: "posted" | "transit" | "returned" }) {
  if (kind === "returned")
    return (
      <span className="postmark postmark-box" aria-hidden="true">
        <span className="block text-[9px] tracking-[0.3em]">Return to</span>
        <span className="block text-[17px] leading-none tracking-[0.06em]">SENDER</span>
        <span className="block text-[8px] tracking-[0.2em]">too long for tier</span>
      </span>
    );
  const label = kind === "posted" ? "POSTED" : "IN TRANSIT";
  return (
    <svg viewBox="0 0 220 110" className={cn("postmark", kind === "transit" && "postmark-transit")} aria-hidden="true">
      <defs>
        <path id={`pm-ring-${kind}`} d="M55 55 m-38 0 a38 38 0 1 1 76 0 a38 38 0 1 1 -76 0" />
      </defs>
      <circle cx="55" cy="55" r="48" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={kind === "transit" ? "6 5" : undefined} />
      <circle cx="55" cy="55" r="29" fill="none" stroke="currentColor" strokeWidth="2" />
      <text fontSize="10.5" fontWeight="800" letterSpacing="2.4" fill="currentColor">
        <textPath href={`#pm-ring-${kind}`} startOffset="2%">OUTLY POST · ONE UPLOAD · EVERYWHERE ·</textPath>
      </text>
      <text x="55" y={kind === "posted" ? 59 : 53} textAnchor="middle" fontSize={kind === "posted" ? 12.5 : 10} fontWeight="900" letterSpacing="1" fill="currentColor">
        {kind === "posted" ? label : "IN"}
      </text>
      {kind === "transit" && (
        <text x="55" y="65" textAnchor="middle" fontSize="10" fontWeight="900" letterSpacing="1" fill="currentColor">TRANSIT</text>
      )}
      {[34, 46, 58, 70].map((y) => (
        <path key={y} d={`M112 ${y} q12 -7 24 0 t24 0 t24 0 t24 0`} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      ))}
    </svg>
  );
}

/** Segmented steps with a sliding pill; the lime line inside it is the time left in this step. */
function Steps({ beat, go, running, uid }: { beat: Beat; go: (b: Beat) => void; running: boolean; uid: string }) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = tabs.current[beat];
      if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [beat]);

  const onKey = (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = ((beat + d + 4) % 4) as Beat;
    go(n);
    tabs.current[n]?.focus();
  };

  return (
    <div className="mt-6 flex justify-center">
      <div className="relative inline-flex rounded-full bg-background/80 p-1 hairline" role="tablist" aria-label="Demo steps" onKeyDown={onKey}>
        {pill && (
          <span className="demo-steps-pill absolute bottom-1 top-1 rounded-full bg-foreground" style={{ width: pill.w, transform: `translate3d(${pill.x - 4}px,0,0)`, left: 4 }} aria-hidden="true">
            <span key={beat} className="demo-steps-timer absolute inset-x-4 bottom-[5px] h-[2px] origin-left rounded-full bg-lime" style={{ animationDuration: `${BEAT_MS}ms`, animationPlayState: running ? "running" : "paused" }} />
          </span>
        )}
        {BEATS.map((b, i) => (
          <button
            key={b.label}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${uid}-tab-${i}`}
            aria-selected={i === beat}
            aria-controls={`${uid}-panel`}
            tabIndex={i === beat ? 0 : -1}
            onClick={() => go(i as Beat)}
            className={cn("relative z-[1] min-h-[44px] rounded-full px-3.5 text-sm font-medium transition-colors duration-300 sm:px-5", i === beat ? "text-background" : "text-muted-foreground hover:text-foreground")}
          >
            <span className="tabular mr-1.5 text-xs opacity-60">{i + 1}</span>
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}
