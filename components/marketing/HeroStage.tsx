"use client";
import { Check, Play } from "lucide-react";
import { Collectible, useTilt } from "@/components/shared/Collectible";
import { Icon3D, type IconName } from "@/components/brand/Icon3D";
import { PlatformGlyph } from "@/components/shared/PlatformIcon";
import type { Platform } from "@/lib/domain";

/*
 * Hero stage: a glowing wall of video tiles laid back in perspective (the card-wall
 * look), the creator's one source video standing in front of it, and the three
 * destinations as sticker-bombed collectibles. Pointer tilt moves wall and boxes
 * together through --tx/--ty; every animation is transform-only and CSS-driven, and
 * reduced motion turns the drift off in globals.css. Decorative: the real claims
 * live in the hero copy, so the stage is aria-hidden.
 */

const POSTERS = ["starbucks", "oyo", "zomato", "nokia", "blockbuster", "dyson", "tata-nano", "instagram-burbn"];
const FILLS = [
  "linear-gradient(160deg,#8e35c9,#e3266f)",
  "linear-gradient(160deg,#ff5a52,#8f0d09)",
  "linear-gradient(160deg,#2f7bff,#0d348f)",
  "linear-gradient(160deg,#c2f415,#4f7a00)",
  "linear-gradient(160deg,#2a2a30,#09090b)",
];
const ROWS = [9, 10, 9];

const BOXES: { platform: Platform; cls: string; size: number; delay: string; state?: "ready" }[] = [
  { platform: "instagram", cls: "left-[3%] top-[30%] sm:left-[14%] sm:top-[16%]", size: 116, delay: "0s", state: "ready" },
  { platform: "x", cls: "left-[8%] top-[64%] sm:left-[22%] sm:top-[58%]", size: 92, delay: "-2.4s" },
  { platform: "youtube", cls: "right-[2%] top-[40%] sm:right-[14%] sm:top-[26%]", size: 124, delay: "-4.1s", state: "ready" },
];

const OBJECTS: { name: IconName; cls: string; size: number; rot: string; delay: string }[] = [
  { name: "ai-assistant", cls: "left-[2%] top-[0%] hidden md:block", size: 96, rot: "-7deg", delay: "-1s" },
  { name: "upload", cls: "right-[4%] top-[2%] hidden sm:block", size: 88, rot: "8deg", delay: "-3s" },
  { name: "schedule", cls: "right-[24%] bottom-[0%] hidden md:block", size: 84, rot: "-5deg", delay: "-5s" },
  { name: "analytics", cls: "left-[3%] bottom-[4%] hidden lg:block", size: 92, rot: "6deg", delay: "-2s" },
  { name: "hashtags", cls: "right-[6%] bottom-[22%] hidden lg:block", size: 72, rot: "10deg", delay: "-4s" },
];

function Wall() {
  let k = 0;
  return (
    <div className="hero-wall absolute inset-x-[-12%] bottom-[-6%] top-[18%] flex flex-col items-center gap-3 [mask-image:radial-gradient(70%_80%_at_50%_45%,#000_45%,transparent_78%)]">
      {ROWS.map((n, r) => (
        <div key={r} className="flex gap-3" style={{ transform: `translateX(${r % 2 ? 0 : 52}px)` }}>
          {Array.from({ length: n }).map((_, c) => {
            const i = k++;
            const poster = i % 3 !== 1 ? POSTERS[i % POSTERS.length] : null;
            return (
              <div
                key={c}
                className="hero-tile relative h-[150px] w-[96px] shrink-0 overflow-hidden rounded-[16px] sm:h-[170px] sm:w-[108px]"
                style={{ background: poster ? undefined : FILLS[i % FILLS.length] }}
              >
                {poster && <img src={`/samples/${poster}.svg`} alt="" className="h-full w-full object-cover" loading="eager" decoding="async" draggable={false} />}
                <span className="absolute inset-0 bg-[linear-gradient(150deg,rgba(255,255,255,.28),transparent_42%)]" />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function SourceCard() {
  const variants: { p: Platform; label: string }[] = [
    { p: "instagram", label: "Reel caption" },
    { p: "youtube", label: "Shorts title" },
    { p: "x", label: "Post copy" },
  ];
  return (
    <div className="absolute left-1/2 top-[2%] z-10 -ml-[84px] w-[168px] sm:-ml-[107px] sm:w-[214px]">
      <div className="hero-float" style={{ animationDelay: "-1.5s" }}>
        <div className="relative aspect-[9/16] overflow-hidden rounded-[30px] bg-card p-[6px] shadow-[0_0_0_1px_hsl(var(--foreground)/0.1),0_0_60px_-6px_hsl(var(--lime)/0.55),0_40px_80px_-30px_rgba(0,0,0,0.9)]">
          <div className="relative h-full w-full overflow-hidden rounded-[24px]">
            <img src="/samples/starbucks.svg" alt="" className="h-full w-full object-cover" loading="eager" decoding="async" draggable={false} />
            <span className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/70" />
            <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 font-mono text-[10px] font-semibold tracking-wide text-white">launch-cut.mp4</span>
            <span className="absolute left-1/2 top-[38%] grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-black">
              <Play className="ml-0.5 h-5 w-5 fill-current" aria-hidden="true" />
            </span>
            <ul className="absolute inset-x-2.5 bottom-2.5 flex flex-col gap-1.5">
              {variants.map((v) => (
                <li key={v.p} className="flex items-center gap-2 rounded-xl bg-white/92 px-2 py-1.5 text-[11px] font-semibold text-black shadow-sm">
                  <PlatformGlyph platform={v.p} className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{v.label}</span>
                  <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HeroStage() {
  const tilt = useTilt(7);
  return (
    <div {...tilt} aria-hidden="true" className="hero-stage relative mx-auto h-[440px] w-full max-w-[1180px] select-none sm:h-[520px]">
      <Wall />
      <SourceCard />
      {BOXES.map((b) => (
        <div key={b.platform} className={`absolute z-20 ${b.cls}`}>
          <div className="hero-float origin-center scale-[.62] sm:scale-90 lg:scale-100" style={{ animationDelay: b.delay }}>
            <Collectible platform={b.platform} size={b.size} state={b.state} />
          </div>
        </div>
      ))}
      {OBJECTS.map((o) => (
        <div key={o.name} className={`absolute z-20 ${o.cls}`}>
          <div className="hero-float" style={{ ["--rot" as string]: o.rot, animationDelay: o.delay }}>
            <Icon3D name={o.name} size={o.size} />
          </div>
        </div>
      ))}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}
