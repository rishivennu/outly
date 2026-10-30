"use client";
import { useEffect, useRef, useState } from "react";
import { Minus, Moon, Plus } from "lucide-react";
import { Shell, SectionHead } from "./bits";
import { Reveal } from "./Reveal";
import { cn } from "@/lib/utils";
import { OUTLLY_MIN_PER_VIDEO, TIME_DEFAULTS, minutesLabel, timeSaved } from "@/lib/marketing/time-saved";
import { eveningWeek, EVENING_MIN } from "@/lib/marketing/evenings";

/** Chunky stepper: big number, 44px buttons, arrow keys work on the group via the buttons themselves. */
function Dial({ label, value, min, max, step = 1, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  return (
    <div role="group" aria-label={label} className="ev-dial">
      <p className="ev-dial-label">{label}</p>
      <div className="ev-dial-ctl">
        <button type="button" className="ev-step" onClick={() => set(value - step)} disabled={value <= min} aria-label={`Fewer: ${label.toLowerCase()}`}>
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <output aria-live="polite" className="min-w-[3.2ch] flex-1 text-center">
          <span className="ev-dial-num display block leading-none tabular">{value}</span>
          <span className="ev-dial-unit mt-1 text-[12px] text-muted-foreground">{unit}</span>
        </output>
        <button type="button" className="ev-step" onClick={() => set(value + step)} disabled={value >= max} aria-label={`More: ${label.toLowerCase()}`}>
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** The board shows only as much of the evening as the by-hand week needs (2 to 6 hours), so short weeks still read. */
function evenSpan(maxHandMin: number) {
  return Math.min(EVENING_MIN, Math.max(120, Math.ceil(maxHandMin / 60) * 60));
}
const hourLabel = (h: number) => (h >= 24 ? "12 am" : `${h > 12 ? h - 12 : h} pm`);

/**
 * Time saved (1048 redesign, "Your evenings"): the week drawn as seven evenings from 6 pm (the board shows 2 to 6 hours, as much as the by-hand week needs). The
 * visitor's own uploads fill them by hand, then shrink to Outlly's few minutes. It plays once when it scrolls
 * in (time-based, never scrubbed), and the switch above the board flips it any time. Every figure comes from
 * the visitor's three numbers and the two assumptions written under the board.
 */
export function TimeSaved() {
  const [videos, setVideos] = useState<number>(TIME_DEFAULTS.videos);
  const [platforms, setPlatforms] = useState<number>(TIME_DEFAULTS.platforms);
  const [byHand, setByHand] = useState<number>(TIME_DEFAULTS.byHand);
  const [mode, setMode] = useState<"hand" | "outlly">("hand");
  const touched = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const r = timeSaved({ videos, platforms, byHand });
  const week = eveningWeek({ videos, platforms, byHand });

  // First time the board is on screen: show the by-hand week, then let it shrink. Reduced motion starts on Outlly.
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setMode("outlly");
    let t: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        t = setTimeout(() => !touched.current && setMode("outlly"), 1400);
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (t) clearTimeout(t);
    };
  }, []);
  const pick = (m: "hand" | "outlly") => {
    touched.current = true;
    setMode(m);
  };
  const change = (fn: (v: number) => void) => (v: number) => {
    touched.current = true;
    fn(v);
  };
  const hand = mode === "hand";
  const latest = Math.max(...week.map((d) => (hand ? d.handMin : d.outllyMin)));
  // Same scale in both modes, so flipping the switch shows the bars shrink rather than the axis moving.
  const span = evenSpan(Math.max(...week.map((d) => d.handMin)));
  const hours = Array.from({ length: span / 60 + 1 }, (_, k) => hourLabel(18 + k));

  return (
    <section id="time-saved" className="scroll-mt-24 py-16 sm:py-20" aria-labelledby="time-title">
      <Shell>
        <SectionHead id="time-title" eyebrow="Time saved" title="Get your evenings back." body="Set your week. Watch what posting by hand takes out of it, then what's left with Outlly." />

        <Reveal fx="depth" className="ev-card mt-10">
          <div className="grid gap-3 sm:grid-cols-3">
            <Dial label="Videos a week" value={videos} min={1} max={30} unit={videos === 1 ? "video" : "videos"} onChange={change(setVideos)} />
            <Dial label="Platforms per video" value={platforms} min={1} max={3} unit={platforms === 1 ? "platform" : "platforms"} onChange={change(setPlatforms)} />
            <Dial label="Minutes per platform by hand" value={byHand} min={3} max={45} step={3} unit="min each" onChange={change(setByHand)} />
          </div>

          <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
            <div aria-live="polite">
              <p className="text-[13px] font-semibold text-muted-foreground">{hand ? "Posting by hand takes" : "You get back"}</p>
              <p className="display mt-1 text-[clamp(2.4rem,6vw,4.2rem)] leading-[0.95] tabular">{minutesLabel(hand ? r.manualWeek : r.savedWeek)}</p>
              <p className="mt-1.5 text-[15px] font-medium">{hand ? "of your evenings, every week." : `every week. About ${r.savedMonthHours} hours a month.`}</p>
            </div>
            <div role="radiogroup" aria-label="Show the week" className="ev-switch">
              {(["hand", "outlly"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => pick(m)} className={cn("ev-switch-btn", mode === m && "is-on")}>
                  {m === "hand" ? "By hand" : "With Outlly"}
                </button>
              ))}
            </div>
          </div>

          <div ref={boardRef} className="ev-board mt-6" data-mode={mode}>
            <ol className="ev-axis" aria-hidden="true">
              {hours.map((h) => <li key={h}>{h}</li>)}
            </ol>
            <ul className="ev-days" aria-label={hand ? "Your week, posting by hand" : "Your week, with Outlly"}>
              {week.map((d) => {
                const used = hand ? d.handMin : d.outllyMin;
                const fill = Math.min(1, used / span);
                const over = used - EVENING_MIN;
                return (
                  <li key={d.day} className="ev-day">
                    <div className="ev-night">
                      <span className="ev-free" aria-hidden="true"><Moon className="h-3.5 w-3.5" /></span>
                      <span className="ev-fill" data-hand={hand ? "" : undefined} style={{ ["--f" as string]: fill }}>
                        {d.videos > 0 && Array.from({ length: Math.min(d.videos, 6) }, (_, i) => <i key={i} />)}
                      </span>
                      {over > 0 && <span className="ev-over">+{minutesLabel(over)}</span>}
                    </div>
                    <p className="ev-label">
                      <span className="font-semibold text-foreground">{d.day}</span>
                      <span className="ev-time tabular">{d.videos === 0 ? "free" : over > 0 ? "past 12" : (hand ? d.freeFromHand : d.freeFrom).replace(" pm", "")}</span>
                      <span className="sr-only">
                        {d.videos === 0 ? ": nothing to post, free all evening." : `: ${d.videos} ${d.videos === 1 ? "video" : "videos"}, ${minutesLabel(used)}${over > 0 ? ", past midnight" : `, free from ${hand ? d.freeFromHand : d.freeFrom}`}.`}
                      </span>
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>

          <p className="mt-2 ps-[3.25rem] text-[11.5px] text-muted-foreground sm:ps-[4rem]" aria-hidden="true">Times under each day: when you're done posting.</p>
          <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">
            {latest > EVENING_MIN ? "Some nights run past midnight by hand. " : ""}
            By hand: re-exporting, captions, hashtags and title, then uploading, once per platform ({minutesLabel(r.manualWeek)} a week). With Outlly we count {OUTLLY_MIN_PER_VIDEO} minutes a video: one upload, then a read over the drafts ({minutesLabel(r.outllyWeek)}). An estimate from your numbers, not a promise.
          </p>
        </Reveal>
      </Shell>
    </section>
  );
}
