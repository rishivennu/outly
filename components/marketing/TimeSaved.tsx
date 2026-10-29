"use client";
import { useId, useState } from "react";
import { Shell, SectionHead } from "./bits";
import { Reveal } from "./Reveal";
import { OUTLLY_MIN_PER_VIDEO, TIME_DEFAULTS, minutesLabel, timeSaved } from "@/lib/marketing/time-saved";

function Slider({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void }) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[15px] font-medium">{label}</label>
        <output htmlFor={id} className="text-[15px] font-semibold tabular">{value} {unit}</output>
      </div>
      <input id={id} type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 h-11 w-full cursor-pointer accent-[hsl(var(--lime))]" />
    </div>
  );
}

/**
 * Time saved (1037): a calculator, not a testimonial. The visitor sets their own week and the maths is shown
 * underneath, so nothing on it is a number we made up about anyone else.
 */
export function TimeSaved() {
  const [videos, setVideos] = useState<number>(TIME_DEFAULTS.videos);
  const [platforms, setPlatforms] = useState<number>(TIME_DEFAULTS.platforms);
  const [byHand, setByHand] = useState<number>(TIME_DEFAULTS.byHand);
  const r = timeSaved({ videos, platforms, byHand });
  return (
    <section id="time-saved" className="scroll-mt-24 py-16 sm:py-20" aria-labelledby="time-title">
      <Shell>
        <SectionHead id="time-title" eyebrow="Time saved" title="Get your evenings back." body="Set your own week. The estimate updates as you go, and the working is right underneath it." />
        <Reveal className="mt-10 grid gap-6 rounded-[2rem] p-6 hairline sm:p-8 lg:grid-cols-[1.1fr_1fr] lg:gap-10">
          <Reveal stagger y={16} delay={0.08} className="flex flex-col gap-6">
            <Slider label="Videos you post a week" value={videos} min={1} max={30} unit={videos === 1 ? "video" : "videos"} onChange={setVideos} />
            <Slider label="Platforms per video" value={platforms} min={1} max={3} unit={platforms === 1 ? "platform" : "platforms"} onChange={setPlatforms} />
            <Slider label="Minutes per platform by hand" value={byHand} min={3} max={45} unit="min" onChange={setByHand} />
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              By hand means re-exporting, writing the caption, hashtags and title, and uploading, once for each platform. With Outlly we count {OUTLLY_MIN_PER_VIDEO} minutes a video: one upload, then a read over the drafts.
            </p>
          </Reveal>
          <Reveal y={32} delay={0.16} className="flex">
          <div className="flex flex-1 flex-col justify-between gap-6 rounded-[1.5rem] bg-[hsl(var(--lime)/0.14)] p-6 sm:p-8" aria-live="polite">
            <div>
              <p className="text-[12.5px] font-semibold text-foreground/75">You’d save about</p>
              <p className="display mt-2 text-[clamp(2.6rem,6vw,4rem)] leading-none tabular">{minutesLabel(r.savedWeek)}</p>
              <p className="mt-1 text-[15px] font-medium">every week, roughly {r.savedMonthHours} hours a month.</p>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-[14px]">
              <div className="rounded-2xl bg-background/70 p-4 hairline">
                <dt className="text-foreground/70">By hand</dt>
                <dd className="mt-1 text-lg font-semibold tabular">{minutesLabel(r.manualWeek)}</dd>
              </div>
              <div className="rounded-2xl bg-background/70 p-4 hairline">
                <dt className="text-foreground/70">With Outlly</dt>
                <dd className="mt-1 text-lg font-semibold tabular">{minutesLabel(r.outllyWeek)}</dd>
              </div>
            </dl>
            <p className="text-[12.5px] text-foreground/70">An estimate from your numbers, not a promise.</p>
          </div>
          </Reveal>
        </Reveal>
      </Shell>
    </section>
  );
}
