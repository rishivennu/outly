"use client";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Check, Info, Loader2, Play, RotateCcw, Sparkles } from "lucide-react";
import { AppIcon } from "@/components/brand/brands";
import { cn } from "@/lib/utils";
import { Reveal } from "./Reveal";

/*
 * v6 "bento" (10-15): laid out like the reference agency bento, held to Apple's rules.
 * The product leads: a phone on its own tinted stage runs the real create -> publish flow.
 * The headline floats on the canvas with one highlighted phrase and the step control under it.
 * One accent tile (violet) says what the step amounts to, a light word over a heavy one.
 * The three posts sit as soft cards in one tray; on phones the tray is a swipe rail.
 * Nothing here talks to a server. Four beats loop; the last deliberately shows a failure,
 * because that is the state the product is designed around.
 *
 * Motion budget: React re-renders only on beat changes. Everything in between is CSS
 * transforms, opacity and clip-path on the compositor. Reduced motion lands on the last beat.
 */

type Beat = 0 | 1 | 2 | 3;
const BEAT_MS = 4200;
const ORDER = ["instagram", "youtube", "x"] as const;
type Core = (typeof ORDER)[number];
const COUNT = ["None", "One", "Two", "Three"];

const BEATS = [
  {
    label: "Upload",
    caption: "One file lands in your library. Every destination waits for it.",
  },
  {
    label: "Tailor",
    caption:
      "AI writes copy in each platform's own shape: a caption, a title, a post.",
  },
  {
    label: "Send",
    caption: "Each destination becomes its own job, with its own progress.",
  },
  {
    label: "Track",
    caption:
      "One is live, one is still processing, one needs a hand. Retry only that one.",
  },
] as const;

const COPY: Record<
  Core,
  { name: string; format: string; field: string; text: string; tags?: string }
> = {
  instagram: {
    name: "Instagram",
    format: "Reel",
    field: "Caption",
    text: "I rebuilt my whole desk setup in a weekend. Here's the one change that did it.",
    tags: "#desksetup #workspace",
  },
  youtube: {
    name: "YouTube",
    format: "Short",
    field: "Title",
    text: "The one desk change that fixed my workflow",
  },
  x: {
    name: "X",
    format: "Post",
    field: "Post",
    text: "Spent a weekend on my desk. One change did 90% of the work:",
  },
};

type Tone = "idle" | "work" | "done" | "fail";
type Retry = "idle" | "running" | "done";

function state(
  p: Core,
  beat: Beat,
  retry: Retry,
): { status: string; tone: Tone; fill: number; note: string } {
  if (p === "x" && beat === 3 && retry !== "idle")
    return retry === "running"
      ? {
          status: "Retrying",
          tone: "work",
          fill: 1,
          note: "Sending a trimmed version.",
        }
      : {
          status: "Published",
          tone: "done",
          fill: 1,
          note: "Live, with a link to the post.",
        };
  if (beat === 0)
    return {
      status: "Waiting for file",
      tone: "idle",
      fill: 0,
      note: "Starts once the upload finishes.",
    };
  if (beat === 1)
    return {
      status: "Draft ready",
      tone: "idle",
      fill: 0,
      note: "You can edit it before anything is sent.",
    };
  if (beat === 2)
    return {
      status: p === "youtube" ? "Queued" : "Uploading",
      tone: "work",
      fill: p === "instagram" ? 0.78 : p === "youtube" ? 0.36 : 0.55,
      note: p === "youtube" ? "Next in line." : "Sending the video.",
    };
  if (p === "instagram")
    return {
      status: "Published",
      tone: "done",
      fill: 1,
      note: "Live, with a link to the post.",
    };
  if (p === "youtube")
    return {
      status: "Processing",
      tone: "work",
      fill: 0.92,
      note: "YouTube is still processing. We keep checking.",
    };
  return {
    status: "Media rejected",
    tone: "fail",
    fill: 0.6,
    note: "X said the file is too long for this account tier.",
  };
}

const TONE_TEXT: Record<Tone, string> = {
  idle: "text-muted-foreground",
  work: "text-accent",
  done: "text-success",
  fail: "text-destructive",
};

/** The two words on the left: what the beat amounts to. */
function headline(beat: Beat, done: number) {
  if (beat === 0) return ["One", "upload."];
  if (beat === 1) return ["Three", "drafts."];
  if (beat === 2) return ["Three", "sends."];
  return [COUNT[done], "live."];
}

export function DemoFlow({ head }: { head?: React.ReactNode }) {
  const uid = useId();
  const rail = useRail();
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
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {
      threshold: 0.3,
    });
    if (root.current) io.observe(root.current);
    return () => {
      mq.removeEventListener("change", apply);
      document.removeEventListener("visibilitychange", vis);
      io.disconnect();
    };
  }, []);

  const running =
    mounted && !reduced && visible && !hover && !hidden && retry !== "running";

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
    const t = window.setTimeout(
      () => setBeat((b) => ((b + 1) % 4) as Beat),
      Math.max(0, remaining.current),
    );
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
  const states = ORDER.map((p) => state(p, beat, retry));
  const done = states.filter((s) => s.tone === "done").length;

  return (
    <div
      ref={root}
      className="dm-grid mx-auto w-full max-w-[1180px]"
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={() => setHover(false)}
      data-beat={beat}
      data-running={running ? "" : undefined}
    >
      {/* the headline floats on the canvas, the way the reference sets its type between tiles */}
      <div className="dm-a-head flex flex-col gap-6 sm:gap-7">
        {head}
        <div className="dm-head-ctl flex flex-col items-center gap-3 sm:items-start">
          <Steps beat={beat} go={go} running={running} uid={uid} />
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground sm:pl-4">
            <Info className="h-3 w-3" aria-hidden="true" />
            Illustration, not live data. Use the steps or let it play.
          </p>
        </div>
      </div>

      {/* the beat: one bold accent tile with a light word over a heavy one */}
      <Reveal delay={0.05} className="dm-a-beat">
        <BeatTile beat={beat} states={states} done={done} uid={uid} />
      </Reveal>

      {/* the product: the phone on its own tinted stage, rings behind it per destination */}
      <Reveal delay={0.1} className="dm-a-stage dm-stage">
        <div className="relative">
          <div className="dm-rings" aria-hidden="true">
            {ORDER.map((p, i) => (
              <span
                key={p}
                className={cn(
                  "dm-ring",
                  `dm-ring-${p}`,
                  beat === 2 && "is-send",
                  states[i].tone === "done" && "is-live",
                  states[i].tone === "fail" && "is-fail",
                )}
                style={{ ["--i" as string]: i }}
              />
            ))}
          </div>
          <div className="dm-phone-fit">
            <Phone beat={beat} states={states} done={done} />
          </div>
        </div>
      </Reveal>

      {/* the three posts it becomes, as soft cards in one tray (a swipe rail on phones) */}
      <Reveal delay={0.15} className="dm-a-tray dm-tray">
        <ul
          className="dm-rail"
          aria-label="Destinations"
          tabIndex={rail ? 0 : undefined}
        >
          {ORDER.map((p, i) => (
            <PostWidget
              key={p}
              p={p}
              i={i}
              beat={beat}
              s={states[i]}
              retry={retry}
              onRetry={() => setRetry("running")}
            />
          ))}
        </ul>
      </Reveal>
    </div>
  );
}

type St = ReturnType<typeof state>;

/** Phones only: the post cards become a swipe rail, which needs to be reachable by keyboard. */
function useRail() {
  const [rail, setRail] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const on = () => setRail(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return rail;
}

/**
 * The accent tile: which step, what it amounts to (a light word over a heavy one) and the
 * three destinations with their state. It is the tab panel for the step control.
 */
function BeatTile({
  beat,
  states,
  done,
  uid,
}: {
  beat: Beat;
  states: St[];
  done: number;
  uid: string;
}) {
  const [w1, w2] = headline(beat, done);
  return (
    <div
      id={`${uid}-panel`}
      role="tabpanel"
      aria-labelledby={`${uid}-tab-${beat}`}
      aria-live="polite"
      className="dm-beat dm-copy"
    >
      <p className="flex items-center justify-between gap-3 text-[13px] font-semibold">
        <span>
          Step <span className="tabular">{beat + 1}</span> of 4
        </span>
        <span className="rounded-full bg-white/[0.16] px-2.5 py-1 text-[12px]">
          {BEATS[beat].label}
        </span>
      </p>
      <p
        key={`w-${beat}-${done}`}
        className="dm-word mt-5 font-display leading-[0.9] tracking-[-0.045em]"
      >
        <span className="block font-light">{w1}</span>
        <span className="block font-bold">{w2}</span>
      </p>
      <div className="mt-auto pt-4">
        <p
          key={`c-${beat}`}
          className="demo-caption text-pretty text-[15px] leading-relaxed"
        >
          {BEATS[beat].caption}
        </p>
        <div className="mt-5 flex items-center gap-3" aria-hidden="true">
          {ORDER.map((p, i) => {
            const t = states[i].tone;
            return (
              <span key={p} className="relative">
                <AppIcon brand={p} size={34} />
                <span
                  className={cn(
                    "absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full ring-2 ring-[hsl(var(--dm-violet))] transition-colors duration-500",
                    t === "done"
                      ? "bg-[#1fa463] text-white"
                      : t === "fail"
                        ? "bg-[#e5484d] text-white"
                        : t === "work"
                          ? "demo-pulse bg-white"
                          : "bg-white/45",
                  )}
                >
                  {t === "done" && (
                    <Check className="h-2.5 w-2.5" strokeWidth={4} />
                  )}
                  {t === "fail" && (
                    <span className="text-[9px] font-bold leading-none">!</span>
                  )}
                </span>
              </span>
            );
          })}
          <span className="ml-auto text-[14px] font-semibold tabular">
            {done} of 3 live
          </span>
        </div>
      </div>
    </div>
  );
}

/** An iPhone running the composer: the one file, the three destinations, the publish button. */
function Phone({
  beat,
  states,
  done,
}: {
  beat: Beat;
  states: St[];
  done: number;
}) {
  return (
    <div className="dm-phone" aria-hidden="true">
      <div className="dm-screen">
        <div className="dm-island" />
        <div className="flex items-center justify-between px-6 pt-3 text-[11px] font-semibold tabular">
          <span>9:41</span>
          <span className="flex items-center gap-1">
            <svg
              viewBox="0 0 18 12"
              className="h-2.5 w-3.5"
              fill="currentColor"
            >
              <rect x="0" y="8" width="3" height="4" rx="1" />
              <rect x="5" y="5" width="3" height="7" rx="1" />
              <rect x="10" y="2.5" width="3" height="9.5" rx="1" />
              <rect x="15" y="0" width="3" height="12" rx="1" />
            </svg>
            <span className="inline-block h-2.5 w-5 rounded-[3px] border border-current p-[1.5px]">
              <span className="block h-full w-[70%] rounded-[1px] bg-current" />
            </span>
          </span>
        </div>

        <div className="mt-5 flex items-center justify-between px-4">
          <span className="text-[12px] text-muted-foreground">Cancel</span>
          <span className="text-[13px] font-semibold">New post</span>
          <span className="text-[12px] font-semibold text-lime-ink dark:text-lime">
            Drafts
          </span>
        </div>

        {/* the file */}
        <div className="mx-3 mt-4 flex items-center gap-3 rounded-[16px] bg-[hsl(var(--ap-canvas))] p-2.5">
          <span className="demo-video relative h-[74px] w-[42px] shrink-0 overflow-hidden rounded-[9px]">
            <DeskScene />
            <span className="demo-video-sheen" />
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-white/90 text-[#111]">
                <Play className="ml-[1px] h-2.5 w-2.5 fill-current" />
              </span>
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-semibold">
              desk-setup.mp4
            </span>
            <span className="block text-[10.5px] text-muted-foreground tabular">
              0:28 · 1080p · 42 MB
            </span>
            <span className="mt-2 block h-1 overflow-hidden rounded-full bg-foreground/10">
              <span
                key={beat === 0 ? "up-0" : "up-done"}
                className={cn(
                  "demo-upload block h-full origin-left rounded-full bg-lime",
                  beat === 0 ? "is-filling" : "is-full",
                )}
              />
            </span>
          </span>
        </div>

        <p className="mx-4 mt-4 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Destinations
          {beat === 1 && (
            <span
              key="ai"
              className="demo-chip ml-auto inline-flex items-center gap-1 normal-case tracking-normal text-lime-ink dark:text-lime"
            >
              <Sparkles className="h-3 w-3" /> Tailoring 3 drafts
            </span>
          )}
        </p>
        <ul className="mx-3 mt-1.5 overflow-hidden rounded-[16px] bg-[hsl(var(--ap-canvas))]">
          {ORDER.map((p, i) => {
            const s = states[i];
            return (
              <li
                key={p}
                className="flex items-center gap-2.5 border-t border-foreground/[0.07] px-2.5 py-2 first:border-t-0"
              >
                <AppIcon brand={p} size={26} />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block text-[12px] font-semibold">
                    {COPY[p].name}
                  </span>
                  <span className="block text-[10.5px] text-muted-foreground">
                    {COPY[p].format}
                  </span>
                </span>
                <PhoneStatus beat={beat} s={s} />
              </li>
            );
          })}
        </ul>

        <div className="absolute inset-x-3 bottom-6">
          <span
            className={cn(
              "dm-publish flex h-11 items-center justify-center gap-1.5 rounded-full text-[13px] font-semibold",
              beat === 2 && "is-press",
              beat === 3
                ? "bg-foreground/[0.08] text-foreground"
                : "bg-lime text-[hsl(var(--lime-foreground))]",
            )}
          >
            {beat < 2 && <>Publish to 3</>}
            {beat === 2 && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />{" "}
                Sending
              </>
            )}
            {beat === 3 && (
              <>
                <Check className="h-3.5 w-3.5 text-success" strokeWidth={3} />{" "}
                <span className="tabular">{done} of 3</span> live
              </>
            )}
          </span>
          <span className="mx-auto mt-2.5 block h-1 w-24 rounded-full bg-foreground/80" />
        </div>
      </div>
    </div>
  );
}

function PhoneStatus({ beat, s }: { beat: Beat; s: St }) {
  if (beat === 0)
    return <span className="text-[10.5px] text-muted-foreground">Waiting</span>;
  if (s.tone === "done")
    return (
      <span
        key="d"
        className="demo-chip grid h-5 w-5 place-items-center rounded-full bg-success text-white"
      >
        <Check className="h-3 w-3" strokeWidth={3.5} />
      </span>
    );
  if (s.tone === "fail")
    return (
      <span
        key="f"
        className="demo-chip grid h-5 w-5 place-items-center rounded-full bg-destructive text-[11px] font-bold text-white"
      >
        !
      </span>
    );
  if (s.tone === "work")
    return (
      <svg
        key="w"
        viewBox="0 0 20 20"
        className="dm-progress h-5 w-5 -rotate-90"
        style={{ ["--fill" as string]: s.fill }}
      >
        <circle
          cx="10"
          cy="10"
          r="8"
          fill="none"
          stroke="currentColor"
          strokeOpacity=".15"
          strokeWidth="2.5"
        />
        <circle
          cx="10"
          cy="10"
          r="8"
          fill="none"
          stroke="hsl(var(--accent))"
          strokeWidth="2.5"
          strokeLinecap="round"
          pathLength="1"
          strokeDasharray="1"
        />
      </svg>
    );
  return (
    <span
      key="r"
      className="demo-chip text-[10.5px] font-semibold text-lime-ink dark:text-lime"
    >
      Ready
    </span>
  );
}

/** One destination as a widget: the AI copy for that platform, its job status and, if it failed, a retry. */
function PostWidget({
  p,
  i,
  beat,
  s,
  retry,
  onRetry,
}: {
  p: Core;
  i: number;
  beat: Beat;
  s: St;
  retry: Retry;
  onRetry: () => void;
}) {
  const c = COPY[p];
  const live = s.tone === "done";
  return (
    <li
      className={cn(
        "dm-widget dm-card",
        `dm-card-${p}`,
        beat === 0 && "is-wait",
        live && "is-done",
        s.tone === "fail" && "is-fail",
      )}
      style={{ ["--i" as string]: i }}
    >
      {/* widget anatomy: icon and status badge on top, the title on its own line so it never wraps beside the badge */}
      <div className="flex items-start justify-between gap-2">
        <AppIcon brand={p} size={36} />
        {s.tone === "fail" ? (
          <span
            key="fail"
            className="demo-chip dm-badge inline-flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-destructive"
          >
            <span
              className="h-1.5 w-1.5 rounded-full bg-destructive"
              aria-hidden="true"
            />{" "}
            {s.status}
          </span>
        ) : (
          <span
            key={s.status}
            className={cn(
              "demo-chip dm-badge inline-flex shrink-0 items-center gap-1.5 text-[12px] font-semibold",
              TONE_TEXT[s.tone],
            )}
          >
            {live ? (
              <span className="demo-tick grid h-5 w-5 place-items-center rounded-full bg-success/15">
                <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
              </span>
            ) : (
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  s.tone === "work"
                    ? "demo-pulse bg-accent"
                    : "bg-muted-foreground/60",
                )}
                aria-hidden="true"
              />
            )}
            {s.status}
          </span>
        )}
      </div>
      <p className="mt-3 text-[15px] font-semibold leading-tight tracking-[-0.01em]">
        {c.name} {c.format}
        <span className="mt-0.5 block text-[12px] font-normal tracking-normal text-muted-foreground">
          AI {c.field.toLowerCase()}
        </span>
      </p>

      <div className="relative mt-2.5 min-h-[60px] flex-1">
        <p
          className={cn(
            "demo-type text-[14px] leading-[1.45]",
            beat >= 1 && "is-on",
            p === "youtube" && "font-semibold",
          )}
          style={{ ["--i" as string]: i }}
        >
          {c.text} {c.tags && <span className="text-accent">{c.tags}</span>}
        </p>
        <span
          className={cn("dm-skel", beat === 0 && "is-on")}
          aria-hidden="true"
        >
          <i />
          <i />
          <i />
        </span>
      </div>

      <div
        className={cn(
          "stamp-meter mt-3",
          s.tone === "work" && "is-work",
          live && "is-done",
          s.tone === "fail" && "is-fail",
        )}
        aria-hidden="true"
      >
        <span
          style={{
            transform: `scaleX(${beat >= 2 ? s.fill : 0})`,
            transitionDuration:
              beat === 2
                ? `${BEAT_MS * 0.9}ms`
                : retry === "running"
                  ? "1400ms"
                  : "900ms",
          }}
        />
      </div>
      <div className="mt-2 flex min-h-[36px] items-center gap-2">
        <p
          key={s.note}
          className="demo-chip min-w-0 flex-1 text-[12.5px] leading-4 text-muted-foreground"
        >
          {s.note}
        </p>
        {s.tone === "fail" && (
          <button
            type="button"
            onClick={onRetry}
            className="demo-chip inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full bg-foreground px-3.5 text-xs font-semibold text-background transition-transform duration-200 hover:scale-[1.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-95"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Retry{" "}
            {c.name}
          </button>
        )}
      </div>
    </li>
  );
}

/** A tiny desk-setup illustration (monitor, lamp, plant), white on the video's gradient. */
function DeskScene() {
  return (
    <svg
      viewBox="0 0 90 160"
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <circle cx="68" cy="40" r="11" fill="#fff" opacity=".3" />
      <rect x="0" y="118" width="90" height="42" fill="#fff" opacity=".16" />
      <rect
        x="18"
        y="62"
        width="48"
        height="32"
        rx="3"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
      />
      <path
        d="M42 94v12M33 108h18"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M70 118c-5-9-2-19 5-22 5 5 7 15 2 22z"
        fill="#fff"
        opacity=".85"
      />
      <path d="M0 120h90" stroke="#fff" strokeWidth="2.5" />
    </svg>
  );
}

/** iOS-style segmented control; the lime line inside the selected segment is the time left in this step. */
function Steps({
  beat,
  go,
  running,
  uid,
}: {
  beat: Beat;
  go: (b: Beat) => void;
  running: boolean;
  uid: string;
}) {
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
    <div className="flex justify-center">
      <div
        className="relative inline-flex rounded-full bg-foreground/[0.07] p-1"
        role="tablist"
        aria-label="Demo steps"
        onKeyDown={onKey}
      >
        {pill && (
          <span
            className="demo-steps-pill absolute bottom-1 top-1 rounded-full bg-[hsl(var(--ap-tile))] shadow-[0_3px_8px_-2px_rgba(0,0,0,.18),0_0_0_.5px_rgba(0,0,0,.06)]"
            style={{
              width: pill.w,
              transform: `translate3d(${pill.x - 4}px,0,0)`,
              left: 4,
            }}
            aria-hidden="true"
          >
            <span
              key={beat}
              className="demo-steps-timer absolute inset-x-4 bottom-[5px] h-[2px] origin-left rounded-full bg-lime"
              style={{
                animationDuration: `${BEAT_MS}ms`,
                animationPlayState: running ? "running" : "paused",
              }}
            />
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
            className={cn(
              "relative z-[1] min-h-[44px] rounded-full px-3.5 text-sm font-semibold transition-colors duration-300 sm:px-5",
              i === beat
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="tabular mr-1.5 text-xs opacity-60">{i + 1}</span>
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}
