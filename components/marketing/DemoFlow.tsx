"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Bookmark, Check, Heart, Info, MessageCircle, MoreHorizontal, Play, Repeat2, RotateCcw, Send, Sparkles, ThumbsUp } from "lucide-react";
import { OutlyMark } from "@/components/brand/Logo";
import { PlatformGlyph } from "@/components/shared/PlatformIcon";
import { cn } from "@/lib/utils";
import type { Platform } from "@/lib/domain";

/*
 * v3: a mock of the real create -> publish flow, shown as the three posts it turns into.
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
        <ul className="demo-rail relative flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 py-5 sm:px-6 sm:py-6 md:grid md:grid-cols-3 md:overflow-visible" aria-label="Destinations">
          {ORDER.map((p, i) => (
            <PostCard key={p} p={p} i={i} beat={beat} retry={retry} onRetry={() => setRetry("running")} />
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

function PostCard({ p, i, beat, retry, onRetry }: { p: Platform; i: number; beat: Beat; retry: Retry; onRetry: () => void }) {
  const c = COPY[p];
  const s = state(p, beat, retry);
  const drafted = beat >= 1;
  const live = s.tone === "done";

  return (
    <li
      className={cn("demo-post relative flex w-[78%] shrink-0 snap-center flex-col overflow-hidden rounded-[22px] bg-background hairline sm:w-[46%] md:w-auto", beat === 0 && "is-wait", s.tone === "fail" && "is-fail", live && "is-done")}
      style={{ ["--i" as string]: i, ["--pc" as string]: `hsl(var(--${p}))` }}
    >
      {/* platform header */}
      <div className="flex items-center gap-2.5 px-3.5 pb-2.5 pt-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full" style={{ background: `hsl(var(--${p}) / 0.14)`, color: `hsl(var(--${p}))` }}>
          <PlatformGlyph platform={p} className="h-3.5 w-3.5" />
        </span>
        <span className="text-sm font-semibold">{c.name}</span>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{c.format}</span>
        <MoreHorizontal className="ml-auto h-4 w-4 text-muted-foreground/70" aria-hidden="true" />
      </div>

      {/* native preview, fixed height so nothing jumps between beats */}
      <div className="relative h-[268px] px-3.5 pb-1">
        {p === "x" ? <XBody c={c} drafted={drafted} /> : <VerticalBody p={p} c={c} drafted={drafted} />}
        {/* during upload every preview is a skeleton */}
        <div className={cn("demo-skel absolute inset-0 mx-3.5 rounded-[14px]", beat === 0 && "is-on")} aria-hidden="true" />
      </div>

      {/* job status */}
      <div className="mt-auto border-t border-border/70 px-3.5 py-3">
        <div className="flex min-h-[32px] items-center gap-2">
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
            <span key={s.status} className={cn("demo-chip inline-flex items-center gap-1.5 text-xs font-medium", TONE_TEXT[s.tone])}>
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
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
          <span
            className="demo-bar block h-full origin-left rounded-full"
            style={{
              backgroundColor: s.tone === "fail" ? "hsl(var(--destructive))" : live ? "hsl(var(--success))" : "hsl(var(--accent))",
              transform: `scaleX(${beat >= 2 ? s.fill : 0})`,
              transitionDuration: beat === 2 ? `${BEAT_MS * 0.9}ms` : retry === "running" ? "1400ms" : "900ms",
            }}
          />
        </div>
        <p key={s.note} className="demo-chip mt-2 line-clamp-2 min-h-[32px] text-[11px] leading-4 text-muted-foreground">{s.note}</p>
      </div>
    </li>
  );
}

/** Instagram Reel and YouTube Short: the same vertical video, each platform's own chrome. */
function VerticalBody({ p, c, drafted }: { p: Platform; c: (typeof COPY)[Platform]; drafted: boolean }) {
  const yt = p === "youtube";
  return (
    <div className="demo-video relative h-full overflow-hidden rounded-[14px]">
      <span className="demo-video-sheen" aria-hidden="true" />
      <span className={cn("demo-ai absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-lime", drafted && "is-on")}>
        <Sparkles className="h-3 w-3" aria-hidden="true" /> AI {c.field.toLowerCase()}
      </span>
      <span className="absolute inset-0 grid place-items-center" aria-hidden="true">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-white/25 text-white backdrop-blur-sm">
          <Play className="ml-0.5 h-4 w-4 fill-current" />
        </span>
      </span>
      {/* side rail of actions, as each app draws it */}
      <span className="absolute bottom-16 right-2.5 flex flex-col items-center gap-3 text-white/90" aria-hidden="true">
        {yt ? <ThumbsUp className="h-4 w-4" /> : <Heart className="h-4 w-4" />}
        <MessageCircle className="h-4 w-4" />
        {yt ? <Repeat2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        {!yt && <Bookmark className="h-4 w-4" />}
      </span>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-3 pb-3 pt-10 text-white">
        <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold">
          <span className="h-4 w-4 rounded-full bg-white/80" aria-hidden="true" /> {yt ? "@yourchannel" : "yourhandle"}
        </p>
        <div className="relative min-h-[48px] pr-8">
          <p className={cn("demo-type text-[12px] leading-snug", yt && "font-semibold", drafted && "is-on")}>
            {c.text} {c.tags && <span className="text-white/75">{c.tags}</span>}
          </p>
        </div>
      </div>
      <span className="demo-playhead" aria-hidden="true" />
    </div>
  );
}

/** X: text first, the video as an attached card underneath. */
function XBody({ c, drafted }: { c: (typeof COPY)[Platform]; drafted: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-[60px]">
        <span className={cn("demo-ai mb-1 inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-semibold text-lime-ink dark:text-lime", drafted && "is-on")}>
          <Sparkles className="h-3 w-3" aria-hidden="true" /> AI {c.field.toLowerCase()}
        </span>
        <p className={cn("demo-type text-[13px] leading-snug text-foreground/90", drafted && "is-on")}>{c.text}</p>
      </div>
      <div className="demo-video relative mt-2 min-h-0 flex-1 overflow-hidden rounded-[14px]">
        <span className="demo-video-sheen" aria-hidden="true" />
        <span className="absolute inset-0 grid place-items-center" aria-hidden="true">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-white/25 text-white backdrop-blur-sm">
            <Play className="ml-0.5 h-4 w-4 fill-current" />
          </span>
        </span>
        <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white tabular">0:28</span>
      </div>
      <div className="mb-1 mt-2.5 flex items-center justify-between px-1 text-muted-foreground/70" aria-hidden="true">
        <MessageCircle className="h-4 w-4" />
        <Repeat2 className="h-4 w-4" />
        <Heart className="h-4 w-4" />
        <Bookmark className="h-4 w-4" />
      </div>
    </div>
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
