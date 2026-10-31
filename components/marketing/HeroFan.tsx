"use client";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Icon3D, type IconName } from "@/components/brand/Icon3D";
import { PlatformGlyph } from "@/components/shared/PlatformIcon";
import { useWaitlist } from "./useWaitlist";
import { CaptionPop } from "./CaptionPop";
import type { Platform } from "@/lib/domain";

/*
 * Hero card fan: five tall, saturated cards arched like a hand of cards. The raised centre
 * card is the creator's one upload (with the CTA pill); the four around it are where it goes.
 * Purely decorative (the real claims and the primary CTA live in the hero copy), so the
 * fan is aria-hidden and its pill is removed from the tab order. Motion is CSS only and
 * reduced motion switches it off in globals.css.
 */
// `caption`: Reel-style word-by-word captions on the card (CaptionPop).
export type FanCard = { key: string; title: string; sub: string; icon: IconName; tone: string; platform?: Platform; rot: number; y: number; hideSm?: boolean; caption?: string };
const CARDS: FanCard[] = [
  { key: "sched", title: "Schedule", sub: "Best time, picked for you", icon: "schedule", tone: "hf-purple", rot: -15, y: 96, hideSm: true },
  { key: "ig", title: "Reels", sub: "Instagram caption", icon: "hashtags", tone: "hf-pink", platform: "instagram", rot: -8, y: 34, caption: "Upload once. Post everywhere." },
  { key: "you", title: "Your video", sub: "Upload once", icon: "upload", tone: "hf-lime", rot: 0, y: 0 },
  { key: "yt", title: "Shorts", sub: "YouTube title", icon: "hook-generator", tone: "hf-red", platform: "youtube", rot: 8, y: 34 },
  { key: "x", title: "X posts", sub: "Copy that fits", icon: "write-captions", tone: "hf-blue", platform: "x", rot: 15, y: 96, hideSm: true },
];

/** The signed-in studio home uses the same fan with its own cards and pill (see HomeHero). */
/** Mouse only: the hovered card leans toward the pointer and a soft light follows it. CSS eases every value. */
function tiltTo(e: React.PointerEvent<HTMLDivElement>) {
  if (e.pointerType !== "mouse") return;
  const el = e.currentTarget.querySelector<HTMLElement>(".hf-tilt");
  if (!el) return;
  const r = el.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  el.style.setProperty("--ry", `${((x - 0.5) * 12).toFixed(2)}deg`);
  el.style.setProperty("--rx", `${((0.5 - y) * 9).toFixed(2)}deg`);
  el.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
  el.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
}
function tiltReset(e: React.PointerEvent<HTMLDivElement>) {
  const el = e.currentTarget.querySelector<HTMLElement>(".hf-tilt");
  el?.style.setProperty("--ry", "0deg");
  el?.style.setProperty("--rx", "0deg");
}

/** `framed`: the landing's original boxed stage (hard sides, 64px fade into the page), which the dotted rule below lines up with. */
/** `cta={null}`: no pill on the centre card, for pages that already show the real button right above the fan. */
export function HeroFan({ cards = CARDS, cta, framed = false }: { cards?: FanCard[]; cta?: { href: string; label: string } | null; framed?: boolean }) {
  const waitlist = useWaitlist();
  const pill = cta === null ? null : cta ?? (waitlist ? { href: "/waitlist", label: "Join waitlist" } : { href: "/signup", label: "Get started" });
  return (
    <div aria-hidden="true" className={`hf-stage ${framed ? "hf-framed" : ""} pointer-events-none relative mx-auto -mt-[64px] h-[404px] w-full max-w-[1180px] select-none overflow-hidden sm:h-[448px]`}>
      <div className="hf-fan absolute inset-x-0 bottom-0 flex items-end justify-center">
        {cards.map((c, i) => (
          <div
            key={c.key}
            className={`hf-slot ${c.hideSm ? "hidden md:block" : ""} ${c.key === "you" ? "z-30" : i === 1 || i === 3 ? "z-20" : "z-10"}`}
            style={{ ["--r" as string]: `${c.rot}deg`, ["--y" as string]: `${c.y}px`, ["--d" as string]: `${120 + Math.abs(i - 2) * 90}ms` }}
            onPointerMove={tiltTo}
            onPointerLeave={tiltReset}
          >
            <div className={`hf-lift ${c.key === "you" ? "hf-lift-hero" : ""}`}>
            <div className="hf-tilt">
            <span className={`hf-cast ${c.key === "you" ? "hf-cast-hero" : ""}`} />
            <div className={`hf-card ${c.tone} ${c.key === "you" ? "hf-hero" : ""}`}>
              <div className="relative z-10 flex items-start justify-between gap-2">
                <div className="hf-head">
                  <p className="hf-title">{c.title}</p>
                  <p className="hf-sub">{c.sub}</p>
                </div>
                {c.platform ? (
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/90 text-black shadow-sm"><PlatformGlyph platform={c.platform} className="h-4 w-4" /></span>
                ) : null}
              </div>
              {c.caption ? <CaptionPop text={c.caption} srText={false} className="hf-cap" /> : null}
              {c.key === "you" && pill ? (
                <Link href={pill.href} tabIndex={-1} className="hf-pill">
                  {pill.label}
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-lime text-[hsl(var(--lime-foreground))]"><ArrowUpRight className="h-4 w-4" /></span>
                </Link>
              ) : null}
              <div className="hf-obj"><div className="hf-bob" style={{ animationDelay: `${-i * 1.1}s` }}><Icon3D name={c.icon} size={c.key === "you" ? 150 : 128} /></div></div>
              <span className="hf-shine" />
              <span className="hf-spot" />
              <span className="hf-dim" />
            </div>
            </div>
            </div>
          </div>
        ))}
      </div>
      {framed && <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 h-16 bg-gradient-to-t from-background to-transparent" />}
    </div>
  );
}

/**
 * The two loose 3D props ("SHIP IT", "STATS"). 1044b: they used to float inside the fan's stage, where the cards
 * fill every pixel of width, so they always covered the outer cards' labels. They now float in the empty gutters
 * beside the hero copy. Place inside the copy wrapper (position: relative); only from lg up, where the gutters exist.
 */
export function HeroProps({ wide = false }: { wide?: boolean }) {
  // `wide`: the studio home shares its width with the sidebar, so the gutters only open up from xl.
  const show = wide ? "hidden xl:block" : "hidden lg:block";
  return (
    <>
      <div aria-hidden="true" className={`hf-prop pointer-events-none left-3 top-[30%] xl:left-[2%] ${show}`} style={{ ["--rot" as string]: "-10deg", animationDelay: "-2s" }}><Icon3D name="publish" size={92} /></div>
      <div aria-hidden="true" className={`hf-prop pointer-events-none right-3 top-[52%] xl:right-[2%] ${show}`} style={{ ["--rot" as string]: "8deg", animationDelay: "-4s" }}><Icon3D name="analytics" size={86} /></div>
    </>
  );
}

/** Name tags with a cursor arrow, floating beside the headline like collaborators on a canvas. */
export function CursorTag({ name, tone, side, className }: { name: string; tone: "teal" | "pink"; side: "l" | "r"; className?: string }) {
  return (
    <span aria-hidden="true" className={`hf-tag hf-tag-${tone} ${className ?? ""}`} style={{ ["--dd" as string]: side === "l" ? "-1s" : "-3.5s" }}>
      <svg viewBox="0 0 16 16" className={`hf-cursor ${side === "l" ? "hf-cursor-r" : "hf-cursor-l"}`}><path d="M2 1.5 14 7l-5.2 1.6L6.6 14z" /></svg>
      {name}
    </span>
  );
}

/** Small four-point sparkles scattered over the hero background. */
const SPARKS: [string, string, number][] = [["8%", "18%", 14], ["90%", "12%", 12], ["16%", "62%", 10], ["84%", "58%", 16], ["36%", "8%", 9], ["66%", "30%", 11], ["4%", "40%", 9], ["96%", "38%", 10]];
export function Sparkles() {
  return (
    <div aria-hidden="true" data-parallax="-48" className="pointer-events-none absolute inset-0">
      {SPARKS.map(([l, t, s], i) => (
        // The twinkle runs on a wrapper span: animating the <svg> itself forces an SVG layout every frame.
        <span key={i} className="hf-spark absolute block" style={{ left: l, top: t, width: s, height: s, animationDelay: `${-i * 0.7}s` }}>
          <svg viewBox="0 0 20 20" width={s} height={s} className="block">
            <path d="M10 0c.6 5.4 4 8.8 10 10-6 1.2-9.4 4.6-10 10-.6-5.4-4-8.8-10-10C6 8.8 9.4 5.4 10 0z" />
          </svg>
        </span>
      ))}
    </div>
  );
}
