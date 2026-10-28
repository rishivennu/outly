"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { PlatformGlyph } from "@/components/shared/PlatformIcon";
import { SignupCta } from "./SignupCta";
import { cn } from "@/lib/utils";

/*
 * Try it (10-28). Anything typed goes to /api/try, which runs the studio's hook + caption engine. The three
 * sample chips answer instantly from drafts that engine wrote once (no model call per visitor). If the writer
 * is slow, down or out of free tries, a local template fills the cards and the note says so. Look follows the user's liquid-glass references, in brand colours (user, 10-28:
 * no blue): frosted panels on a near-black stage with lime energy waves, a glowing lime "Write my posts" pill, frosted icon tiles with a coloured blur,
 * a glass tab bar on phones, and a white pill hand-off.
 */

type Drafts = Record<Platform & ("instagram" | "youtube" | "x"), string>;
type Key = keyof Drafts;

const ORDER: Key[] = ["instagram", "youtube", "x"];
const KIND: Record<Key, string> = { instagram: "Reel caption", youtube: "Shorts title", x: "Post" };
const LIMIT: Record<Key, number> = {
  instagram: PLATFORM_META.instagram.captionLimit,
  youtube: PLATFORM_META.youtube.titleLimit ?? 100,
  x: PLATFORM_META.x.captionLimit,
};
const BLOB: Record<Key, string> = {
  instagram: "linear-gradient(135deg, #f58529, #dd2a7b 50%, #8134af)",
  youtube: "linear-gradient(135deg, #ff4d4d, #c4002b)",
  x: "linear-gradient(135deg, #e5e7eb, #6b7280)",
};

// Written by the real engine through /api/try (Gemini, 10-28) and kept verbatim, so the chips answer instantly.
const SAMPLES: { topic: string; drafts: Drafts }[] = [
  {
    topic: "desk setup tour",
    drafts: {
      instagram:
        "You're styling your desk wrong. Minimalist setup vs chaotic clutter: which one actually keeps your focus sharp all day? Send this to a friend who needs a workspace upgrade. 📈\n\n#desksetup #desk #setup #tour #creatorsofinstagram",
      youtube: "Desk Setup Tour: How to build a productive workspace in 3 steps",
      x: "You're styling your desk wrong. Unpopular opinion: dual monitors are dead and a single ultrawide screen changes your workflow completely. Agree or disagree?",
    },
  },
  {
    topic: "3 sleep tips",
    drafts: {
      instagram:
        "Stop counting sheep, you're doing sleep all wrong. Here is the proven bedtime routine for instant deep rest. Send this to a friend who is always exhausted 😴\n\n#sleeptips #betterrest #nightroutine",
      youtube: "Better Sleep: Stop Counting Sheep and Fix Your Routine",
      x: "Stop counting sheep, you're doing sleep all wrong. The old advice of waiting to get tired is destroying your recovery. What is your go-to trick for falling asleep?",
    },
  },
  {
    topic: "first day at work",
    drafts: {
      instagram:
        "Here's what no one tells you about your first day at work. The onboarding docs lie and the real training happens at the coffee machine. Send this to a friend who starts a new job soon.\n\n#firstdayofwork #careertips #corporatehumor #newjob",
      youtube: "First Day at Work: Here's What No One Tells You",
      x: "Here's what no one tells you about your first day at work: nobody expects you to actually know anything for the first month. What was the most awkward part of your first day?",
    },
  },
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const titleCase = (s: string) => s.replace(/\b([a-z])([a-z]*)/g, (_, a: string, b: string) => a.toUpperCase() + b);
const tags = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 3).slice(0, 3).map((w) => `#${w}`);

/** Offline stand-in when the writer can't answer: shaped like real output, always inside each limit. */
function draft(topic: string): Drafts {
  const hit = SAMPLES.find((s) => s.topic === topic.trim().toLowerCase());
  if (hit) return hit.drafts;
  const t = topic.trim().replace(/[.!?]+$/, "");
  const hashtags = [...tags(t), "#creator", "#shorts"].slice(0, 5).join(" ");
  return {
    instagram: `${cap(t)}, start to finish. Save this one for later, and tell me what you would do differently.\n\n${hashtags}`.slice(0, LIMIT.instagram),
    youtube: `${titleCase(t)}: The Full Walkthrough`.slice(0, LIMIT.youtube),
    x: `${cap(t)}. Took me way too long to get right, so here is what actually worked.`.slice(0, LIMIT.x),
  };
}

const TYPE_MS = 900; // per card
const STAGGER_MS = 320;

function useReducedMotion() {
  const [rm, setRm] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setRm(q.matches);
    on();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return rm;
}

export function TryItStage() {
  const rm = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const [topic, setTopic] = useState(SAMPLES[0].topic);
  const [drafts, setDrafts] = useState<Drafts>(SAMPLES[0].drafts);
  // 1 = fully written. Server render shows the first sample in full, so the section reads without JS.
  const [progress, setProgress] = useState<Record<Key, number>>({ instagram: 1, youtube: 1, x: 1 });
  const [writing, setWriting] = useState(false);
  const [tab, setTab] = useState<Key>("instagram");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState("");
  const [forTopic, setForTopic] = useState(SAMPLES[0].topic);
  const raf = useRef(0);
  const req = useRef<AbortController | null>(null);

  async function run(next: string) {
    const t = next.trim().replace(/\s+/g, " ");
    if (t.length < 2) return;
    req.current?.abort();
    cancelAnimationFrame(raf.current);
    const sample = SAMPLES.find((s) => s.topic === t.toLowerCase());
    if (sample) {
      req.current = null; // the aborted run sees it was replaced and drops its answer
      setPending(false);
      setNote("");
      return show(t, sample.drafts);
    }
    const ac = new AbortController();
    req.current = ac;
    const timer = setTimeout(() => ac.abort(), 16_000);
    setWriting(true);
    setPending(true);
    setProgress({ instagram: 0, youtube: 0, x: 0 });
    setStatus("Writing your posts.");
    let d: Drafts | null = null;
    let why = "Our writer is busy right now, so here is a quick version.";
    try {
      const r = await fetch("/api/try", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: t }),
        signal: ac.signal,
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.drafts) d = { instagram: String(j.drafts.instagram ?? ""), youtube: String(j.drafts.youtube ?? ""), x: String(j.drafts.x ?? "") };
      else if (r.status === 429 && typeof j?.error === "string") why = j.code === "TRY_DAILY" ? j.error : "Lots of tries at once. Here is a quick version; try again in a minute.";
    } catch {
      if (req.current !== ac) return; // a newer run replaced this one
    } finally {
      clearTimeout(timer);
    }
    if (req.current !== ac) return;
    setPending(false);
    setNote(d ? "" : why);
    show(t, d ?? draft(t));
  }

  /** Type the drafts into the cards (time-based), or show them at once under reduced motion. */
  function show(t: string, d: Drafts) {
    setDrafts(d);
    setForTopic(t);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setProgress({ instagram: 1, youtube: 1, x: 1 });
      setWriting(false);
      setStatus(`Drafts ready for ${t}.`);
      return;
    }
    setWriting(true);
    setStatus("");
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = {} as Record<Key, number>;
      ORDER.forEach((k, i) => (p[k] = Math.min(1, Math.max(0, (now - t0 - i * STAGGER_MS) / TYPE_MS))));
      setProgress(p);
      if (p.x < 1) raf.current = requestAnimationFrame(tick);
      else {
        setWriting(false);
        setStatus(`Drafts ready for ${t}.`);
      }
    };
    raf.current = requestAnimationFrame(tick);
  }

  // Below the fold on load: blank the cards and write them once when the stage scrolls in (time-based, never scrubbed).
  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.85) return;
    setProgress({ instagram: 0, youtube: 0, x: 0 });
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          io.disconnect();
          run(SAMPLES[0].topic);
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf.current);
      req.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={root} className="try-stage mt-10 sm:mt-12">
      <TryBackdrop />
      <div className="relative grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-6 lg:p-8">
        {/* Input */}
        <form
          className="try-glass flex flex-col gap-5 p-5 sm:p-7"
          onSubmit={(e) => {
            e.preventDefault();
            if (!writing) run(topic);
          }}
        >
          <div>
            <label htmlFor="try-topic" className="text-[15px] font-semibold text-white">
              What is your video about?
            </label>
            <p id="try-hint" className="mt-1 text-[14px] text-white/75">One line is enough. Up to 80 characters.</p>
          </div>
          <input
            id="try-topic"
            aria-describedby="try-hint"
            value={topic}
            maxLength={80}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="desk setup tour"
            autoComplete="off"
            dir="auto"
            className="try-field h-14 w-full rounded-2xl px-5 text-[16px] text-white placeholder:text-white/60"
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Sample ideas">
            {SAMPLES.map((s) => (
              <button
                key={s.topic}
                type="button"
                className="try-chip"
                aria-pressed={topic === s.topic}
                disabled={writing}
                onClick={() => {
                  setTopic(s.topic);
                  run(s.topic);
                }}
              >
                {s.topic}
              </button>
            ))}
          </div>
          <button type="submit" className="try-go self-start" aria-disabled={writing || !topic.trim()}>
            <span>{writing ? "Writing your posts" : "Write my posts"}</span>
            <PaperPlane />
          </button>
          {/* Desktop only: the panel matches the output column's height, so it says what each draft is tuned for. */}
          <ul className="mt-auto hidden gap-2.5 border-t border-white/15 pt-5 text-[14px] text-white/80 lg:grid">
            {["A hook in the first line", "Hashtags sized for each place", "Always inside each limit"].map((t) => (
              <li key={t} className="flex items-center gap-2.5">
                <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none text-[hsl(var(--lime))]" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                {t}
              </li>
            ))}
          </ul>
        </form>

        {/* Output */}
        <div className="flex flex-col gap-4">
          <div className="try-tabs md:hidden" role="group" aria-label="Choose a draft to show">
            {ORDER.map((k) => (
              <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)} className="try-tab">
                <PlatformGlyph platform={k} className="h-[18px] w-[18px]" />
                {PLATFORM_META[k].name}
              </button>
            ))}
          </div>
          {ORDER.map((k) => (
            <OutCard key={k} k={k} text={drafts[k]} p={progress[k]} rm={rm} pending={pending} className={cn(tab !== k && "max-md:hidden")} />
          ))}
          <p className="sr-only" role="status" aria-live="polite">{status}</p>
          <div className="flex flex-col items-start gap-3 pt-1 sm:flex-row sm:items-center sm:gap-5">
            <SignupCta label="Keep these drafts" className="try-keep group" next={`/create?text=${encodeURIComponent(forTopic)}`}>
              <ArrowRight className="h-[18px] w-[18px] transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
            </SignupCta>
            <p className="text-[14px] leading-snug text-white/75">
              {note ? `${note} Sign up free for the full writer.` : "Written just now by Outlly. Sign up free to edit, schedule and post them."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function OutCard({ k, text, p, rm, pending, className }: { k: Key; text: string; p: number; rm: boolean; pending: boolean; className?: string }) {
  // While the writer works, the old draft only reserves the card's height; nothing old shows.
  const shown = pending ? "" : p >= 1 || rm ? text : text.slice(0, Math.round(text.length * p));
  const limit = LIMIT[k];
  const typing = pending || (p > 0 && p < 1 && !rm);
  return (
    <article className={cn("try-glass try-card p-4 sm:p-5", className)} aria-label={`${PLATFORM_META[k].name} ${KIND[k]}`}>
      <div className="flex items-center gap-3">
        <span className="try-icon" style={{ "--blob": BLOB[k] } as React.CSSProperties} aria-hidden="true">
          <PlatformGlyph platform={k} className="h-[22px] w-[22px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-tight text-white">{PLATFORM_META[k].name}</p>
          <p className="text-[13px] text-white/75">{KIND[k]}</p>
        </div>
        <p className="text-[13px] tabular-nums text-white/75">
          <span className="sr-only">Characters: </span>
          {shown.length.toLocaleString("en-US")} / {limit.toLocaleString("en-US")}
        </p>
      </div>
      {/* Full text reserves the height (no jump while typing); the typed copy sits on top in the same grid cell. */}
      <div className="mt-3 grid text-[15px] leading-relaxed text-white/95 [&>*]:[grid-area:1/1]">
        <p className="invisible whitespace-pre-line" aria-hidden="true">{text}</p>
        <p className="whitespace-pre-line" aria-hidden="true">
          {shown}
          {typing && <span className="try-caret" />}
        </p>
        <p className="sr-only">{text}</p>
      </div>
      <div className="try-meter mt-3" aria-hidden="true">
        <span style={{ width: `${Math.max(1.5, Math.min(100, (shown.length / limit) * 100))}%` }} />
      </div>
    </article>
  );
}

function PaperPlane() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.5 2.5 10.6 13.4" />
      <path d="M21.5 2.5 14.6 21l-4-7.6-7.6-4L21.5 2.5Z" />
    </svg>
  );
}

/** Brand wave stage (ref 1's shape, Outlly's lime/energy colours): glass needs something to blur. Static. */
function TryBackdrop() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        {/* Stops are the brand's --energy-a/b/c and --lime, taken darker so white text on the glass keeps 4.5:1. */}
        <linearGradient id="try-w1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="hsl(96 100% 38%)" />
          <stop offset="1" stopColor="hsl(145 90% 14%)" />
        </linearGradient>
        <linearGradient id="try-w2" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="hsl(78 100% 40%)" />
          <stop offset="1" stopColor="hsl(96 60% 10%)" />
        </linearGradient>
        <linearGradient id="try-w3" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="hsl(66 100% 42%)" />
          <stop offset="1" stopColor="hsl(145 90% 22%)" />
        </linearGradient>
      </defs>
      <path d="M-50 260 C 220 120, 420 420, 700 280 S 1100 120, 1260 220 L1260 -40 L-50 -40 Z" fill="url(#try-w2)" opacity=".2" />
      <path d="M-50 470 C 200 330, 460 560, 760 420 S 1120 300, 1260 400 L1260 760 L-50 760 Z" fill="url(#try-w1)" opacity=".3" />
      <path d="M-50 600 C 260 500, 520 700, 820 560 S 1150 520, 1260 580 L1260 760 L-50 760 Z" fill="url(#try-w3)" opacity=".26" />
    </svg>
  );
}
