"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { PlatformGlyph } from "@/components/shared/PlatformIcon";
import { Icon3D, type IconName } from "@/components/brand/Icon3D";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SignupCta } from "./SignupCta";
import { cn } from "@/lib/utils";

/*
 * Try it (10-28). Anything typed goes to /api/try, which runs the studio's hook + caption engine. The sample
 * idea cards answer instantly from drafts that engine wrote once (no model call per visitor). If the writer is
 * slow, down or out of free tries, a local template fills the cards and the note says so.
 *
 * Look (user reference, 10-28): a staggered wall of tall rounded colour cards, each with a white tag pill, a bold
 * short title and a big 3D object, columns set at different heights. (10-28: edge cards and a 4th idea removed.)
 * Colours are the brand's own range, not a rainbow (user, 10-28: no blue).
 */

type Tone = "lime" | "mint" | "cream" | "sage" | "forest" | "ink";

/** The sample ideas as cards: a tag, a short title, a colour and an object. Order is reading order. */
const IDEA_META: Record<string, { tag: string; title: string; tone: Tone; icon: IconName }> = {
  "desk setup tour": { tag: "Tech", title: "Desk setup tour", tone: "lime", icon: "settings" },
  "3 sleep tips": { tag: "Wellness", title: "3 sleep tips", tone: "cream", icon: "schedule" },
  "first day at work": { tag: "Career", title: "First day at work", tone: "mint", icon: "celebration" },
};

type Drafts = Record<Platform & ("instagram" | "youtube" | "x"), string>;
type Key = keyof Drafts;

const ORDER: Key[] = ["instagram", "youtube", "x"];
const KIND: Record<Key, string> = { instagram: "Reel caption", youtube: "Shorts title", x: "Post" };
const LIMIT: Record<Key, number> = {
  instagram: PLATFORM_META.instagram.captionLimit,
  youtube: PLATFORM_META.youtube.titleLimit ?? 100,
  x: PLATFORM_META.x.captionLimit,
};
// Card colour and 3D object per output. Colours stay in the brand range (lime, greens, cream, near-black).
const OUT: Record<Key, { tone: Tone; icon: IconName }> = {
  instagram: { tone: "sage", icon: "write-captions" },
  youtube: { tone: "lime", icon: "platforms" },
  x: { tone: "ink", icon: "hook-generator" },
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
    // Start typing when the first draft card itself is in view (on phones it sits well below the input).
    io.observe(el.querySelector<HTMLElement>(".try-out-instagram") ?? el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf.current);
      req.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cards reveal one by one as each scrolls into view (user, 10-28). Each entrance is time-based (a fixed
  // ~0.9 s rise), started by its own scroll trigger, never scrubbed. Cards that cross together queue up in
  // reading order 0.12 s apart, so it always reads as one card after another. Hidden only once this runs
  // (.tc-armed), so without JS, or under reduced motion, every card is simply there.
  useEffect(() => {
    const wall = root.current;
    if (!wall || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const small = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    const cards = Array.from(wall.querySelectorAll<HTMLElement>("[data-tc]"));
    const GAP = 0.12;
    let nextAt = 0;
    let frame = 0;
    const waiting = new Set<HTMLElement>();
    const play = () => {
      frame = 0;
      const pos = new Map([...waiting].map((e) => [e, e.getBoundingClientRect()]));
      const list = [...waiting].sort((a, b) => pos.get(a)!.top + pos.get(a)!.left * 0.6 - (pos.get(b)!.top + pos.get(b)!.left * 0.6));
      waiting.clear();
      const now = performance.now() / 1000;
      list.forEach((el, i) => {
        const at = Math.max(now, nextAt);
        nextAt = at + GAP;
        gsap.set(el, { transition: "none" });
        gsap.fromTo(
          el,
          { opacity: 0, y: small ? 18 : 64, scale: small ? 0.98 : 0.94, rotate: small ? 0 : i % 2 ? 1.6 : -1.6 },
          {
            opacity: 1, y: 0, scale: 1, rotate: 0, duration: small ? 0.6 : 0.95, ease: "expo.out", delay: at - now,
            clearProps: "opacity,transform,visibility,transition",
            onStart: () => el.setAttribute("data-in", ""),
          },
        );
      });
    };
    const queue = (el: HTMLElement) => {
      waiting.add(el);
      if (!frame) frame = requestAnimationFrame(play);
    };
    wall.classList.add("tc-armed");
    const triggers = cards.map((el) =>
      ScrollTrigger.create({ trigger: el, start: "top 88%", once: true, onEnter: () => queue(el) }),
    );
    // Already on screen or scrolled past (a reload mid-page, a #try jump): show those at once, in order.
    for (const el of cards) if (el.getBoundingClientRect().top < window.innerHeight * 0.88) queue(el);
    return () => {
      triggers.forEach((t) => t.kill());
      cancelAnimationFrame(frame);
      gsap.killTweensOf(cards);
      wall.classList.remove("tc-armed");
      cards.forEach((el) => el.setAttribute("data-in", ""));
    };
  }, []);

  return (
    <div ref={root} className="try-wall mt-10 sm:mt-12">
      <div className="try-cols">
        {/* 1. Your idea */}
        <div className="try-col">
          <form
            className="try-card try-input"
            data-tone="ink"
            data-tc=""
            onSubmit={(e) => {
              e.preventDefault();
              if (!writing) run(topic);
            }}
          >
            <span className="try-pill">Your idea</span>
            <label htmlFor="try-topic" className="try-title mt-4 block">
              What is your video about?
            </label>
            <p id="try-hint" className="try-sub mt-1.5">One line is enough. Up to 80 characters.</p>
            <input
              id="try-topic"
              aria-describedby="try-hint"
              value={topic}
              maxLength={80}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="desk setup tour"
              autoComplete="off"
              dir="auto"
              className="try-field mt-5 h-14 w-full rounded-2xl px-5 text-[16px]"
            />
            <button type="submit" className="try-go mt-4" aria-disabled={writing || !topic.trim()}>
              <span>{writing ? "Writing your posts" : "Write my posts"}</span>
              <PaperPlane />
            </button>
            {/* Desktop: the card is as tall as its column, so it says what every draft gets. */}
            <ul className="try-checks">
              {["A hook in the first line", "Hashtags sized for each place", "Always inside each limit"].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <svg viewBox="0 0 24 24" className="mt-px h-4 w-4 flex-none text-[hsl(var(--lime))]" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                  {t}
                </li>
              ))}
            </ul>
            <Icon3D name="generate-ideas" size={140} className="try-obj pop-in h-[140px] w-[140px]" />
          </form>
        </div>

        {/* 2. Sample ideas */}
        <div className="try-col try-col-ideas">
          <p className="sr-only" id="try-ideas-label">Or pick a sample idea</p>
          {SAMPLES.map((s) => {
            const m = IDEA_META[s.topic];
            const on = forTopic === s.topic && !pending;
            return (
              <button
                key={s.topic}
                type="button"
                className="try-card try-idea"
                data-tone={m.tone}
                data-tc=""
                aria-pressed={on}
                aria-describedby="try-ideas-label"
                disabled={writing}
                onClick={() => {
                  setTopic(s.topic);
                  run(s.topic);
                }}
              >
                <span className="try-pill">
                  {m.tag}
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span className="try-title try-idea-title mt-3 block text-left">{m.title}</span>
                <Icon3D name={m.icon} size={96} className="try-obj pop-in h-[96px] w-[96px]" />
              </button>
            );
          })}
        </div>

        {/* 3 + 4. What Outlly wrote */}
        <div className="try-col try-col-a">
          <div className="try-tabs md:hidden" data-tc="" role="group" aria-label="Choose a draft to show">
            {ORDER.map((k) => (
              <button key={k} type="button" aria-pressed={tab === k} onClick={() => { root.current?.querySelectorAll(".try-out").forEach((e) => e.setAttribute("data-in", "")); setTab(k); }} className="try-tab">
                <PlatformGlyph platform={k} className="h-[18px] w-[18px]" />
                {PLATFORM_META[k].name}
              </button>
            ))}
          </div>
          {(["instagram", "x"] as const).map((k) => (
            <OutCard key={k} k={k} text={drafts[k]} p={progress[k]} rm={rm} pending={pending} className={cn(tab !== k && "max-md:hidden")} />
          ))}
        </div>
        <div className="try-col try-col-b">
          <OutCard k="youtube" text={drafts.youtube} p={progress.youtube} rm={rm} pending={pending} className={cn(tab !== "youtube" && "max-md:hidden")} />
          <div className="try-card try-keepcard" data-tone="forest" data-tc="">
            <span className="try-pill">Next</span>
            <p className="try-title mt-3">Keep these drafts</p>
            <p className="try-sub mt-1.5">
              {note ? `${note} Sign up free for the full writer.` : "Written just now by Outlly. Sign up free to edit, schedule and post them."}
            </p>
            <SignupCta label="Start free" className="try-keep group mt-5" next={`/create?text=${encodeURIComponent(forTopic)}`}>
              <ArrowRight className="h-[18px] w-[18px] transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
            </SignupCta>
            <Icon3D name="drafts" size={110} className="try-obj pop-in h-[110px] w-[110px]" />
          </div>
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{status}</p>
    </div>
  );
}

function OutCard({ k, text, p, rm, pending, className }: { k: Key; text: string; p: number; rm: boolean; pending: boolean; className?: string }) {
  // While the writer works, the old draft only reserves the card's height; nothing old shows.
  const shown = pending ? "" : p >= 1 || rm ? text : text.slice(0, Math.round(text.length * p));
  const limit = LIMIT[k];
  const typing = pending || (p > 0 && p < 1 && !rm);
  const o = OUT[k];
  return (
    <article className={cn("try-card try-out", `try-out-${k}`, className)} data-tone={o.tone} data-tc="" aria-label={`${PLATFORM_META[k].name} ${KIND[k]}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="try-pill">
          <PlatformGlyph platform={k} className="h-3.5 w-3.5" />
          {PLATFORM_META[k].name}
        </span>
        <Icon3D name={o.icon} size={64} className="try-obj-sm pop-in -mr-1 -mt-2 h-16 w-16 flex-none" />
      </div>
      <p className="try-title mt-1">{KIND[k]}</p>
      {/* Full text reserves the height (no jump while typing); the typed copy sits on top in the same grid cell. */}
      <div className="try-text mt-2.5 grid [&>*]:[grid-area:1/1]">
        <p className="invisible whitespace-pre-line" aria-hidden="true">{text}</p>
        <p className="whitespace-pre-line" aria-hidden="true">
          {shown}
          {typing && <span className="try-caret" />}
        </p>
        <p className="sr-only">{text}</p>
      </div>
      <p className="try-count mt-4">
        <span className="sr-only">Characters: </span>
        {shown.length.toLocaleString("en-US")} / {limit.toLocaleString("en-US")}
      </p>
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
