import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowDown, CalendarClock, Check, ChevronRight, RotateCcw, Sparkles } from "lucide-react";
import { AppIcon, type Brand } from "@/components/brand/brands";
import { WaitlistForm } from "@/components/waitlist/WaitlistForm";
import { siteStatus, waitlistCounts } from "@/lib/site";
import { isBeta } from "@/lib/beta";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Join the waitlist", description: "Outlly is letting creators in a few at a time. Leave your email and we'll send your invite." };
export const dynamic = "force-dynamic";

const SOON: Brand[] = ["tiktok", "threads", "linkedin", "facebook"];

function Tile({ className, children, label }: { className?: string; children: React.ReactNode; label: string }) {
  return (
    <li className={cn("wl-tile ap-tile relative overflow-hidden p-5 sm:p-6", className)} aria-label={label}>
      {children}
    </li>
  );
}

/** Small heading inside a tile, Apple bento style: icon-less label above a big statement. */
const Kicker = ({ children }: { children: React.ReactNode }) => <p className="text-[13px] font-semibold text-[hsl(var(--ap-ink2))]">{children}</p>;
const Big = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <p className={cn("mt-1 font-display text-[22px] font-bold leading-[1.15] tracking-[-0.02em] sm:text-[24px]", className)}>{children}</p>
);

export default async function WaitlistPage({ searchParams }: { searchParams: { from?: string } }) {
  const s = await siteStatus();
  if (!s.waitlist) redirect("/signup");
  const counts = await waitlistCounts();
  const beta = await isBeta();
  return (
    <div className="ap-canvas">
      <section className="px-5 pb-10 pt-14 sm:px-8 sm:pb-12 sm:pt-20" aria-labelledby="wl-title">
        <div className="mx-auto flex max-w-[680px] flex-col items-center text-center">
          <p className="wl-rise inline-flex items-center gap-2 rounded-full bg-[hsl(var(--ap-tile))] py-1.5 pl-1.5 pr-4 text-[14px] font-semibold shadow-[0_0_0_1px_hsl(var(--foreground)/.08)]">
            <span className="wl-mini inline-flex"><AppIcon brand="outly" size={26} /></span> {beta ? "Outlly beta" : "Outlly early access"}
          </p>
          <h1 id="wl-title" className="wl-rise display mt-5 text-balance text-[clamp(2.4rem,7vw,4.4rem)]" style={{ animationDelay: ".05s" }}>
            One upload.
            <span className="block text-[hsl(var(--ap-ink2))]">Every feed. Soon.</span>
          </h1>
          <p className="wl-rise mt-4 max-w-[34rem] text-pretty text-[17px] leading-relaxed text-[hsl(var(--ap-ink2))] sm:text-[18px]" style={{ animationDelay: ".1s" }}>
            Here&apos;s what you get on day one. We&apos;re letting creators in a few at a time, so every first post goes out right.
          </p>
          <a href="#join" className="wl-rise lime-glow mt-6 inline-flex h-12 items-center gap-2 rounded-full bg-lime px-6 text-[15px] font-semibold text-[hsl(var(--lime-foreground))] transition-transform active:scale-95" style={{ animationDelay: ".15s" }}>
            Save my spot <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </section>

      <section className="px-5 pb-6 sm:px-8" aria-labelledby="wl-get">
        <div className="mx-auto max-w-[1080px]">
          <h2 id="wl-get" className="sr-only">What you get on day one</h2>
          <ul className="wl-bento wl-rise" style={{ animationDelay: ".2s" }}>
            <Tile className="wl-hub" label="Outlly">
              <span className="flex h-full flex-col items-center justify-center text-center">
                {/* Animated rocket: hovers, rumbles, leaves an exhaust trail and puffs. CSS only; reduced motion keeps it still. */}
                <span className="wl-rocket" aria-hidden="true">
                  <span className="wl-trail" />
                  <span className="wl-trail" />
                  <span className="wl-trail" />
                  <span className="wl-puff" />
                  <span className="wl-puff" />
                  <span className="wl-puff" />
                  <span className="wl-ship">
                    <AppIcon brand="outly" size={96} />
                  </span>
                </span>
                <span className="wl-word mt-5 font-display text-[44px] font-bold leading-none tracking-[-0.04em] sm:text-[56px]">Outlly</span>
                <span className="mt-2 text-[15px] text-[hsl(var(--ap-ink2))]">Upload once, publish everywhere.</span>
              </span>
            </Tile>

            <Tile className="wl-ig" label="Instagram Reels">
              <AppIcon brand="instagram" size={44} />
              <Big className="mt-4">Reels, cut to 9:16.</Big>
            </Tile>
            <Tile className="wl-yt" label="YouTube Shorts">
              <AppIcon brand="youtube" size={44} />
              <Big className="mt-4">Shorts with a real title.</Big>
            </Tile>
            <Tile className="wl-x" label="X">
              <AppIcon brand="x" size={44} />
              <Big className="mt-4">Posts that fit 280.</Big>
            </Tile>

            <Tile className="wl-ai" label="AI drafts">
              <Sparkles className="h-6 w-6 text-[hsl(var(--ap-ink2))]" aria-hidden="true" />
              <Big className="mt-3">A caption per platform, drafted for you.</Big>
              <span aria-hidden="true" className="mt-5 block space-y-2.5">
                {(["instagram", "youtube", "x"] as Brand[]).map((b, i) => (
                  <span key={b} className="flex items-center gap-3 rounded-2xl bg-foreground/[0.04] p-3">
                    <AppIcon brand={b} size={32} className="shrink-0" />
                    <span className="block flex-1 space-y-1.5">
                      <span className="block h-2.5 rounded-full bg-foreground/[0.09]" style={{ width: `${88 - i * 8}%` }} />
                      <span className={cn("block h-2.5 rounded-full", i === 0 ? "bg-lime/70" : "bg-foreground/[0.09]")} style={{ width: `${56 + i * 10}%` }} />
                    </span>
                  </span>
                ))}
              </span>
            </Tile>

            <Tile className="wl-when" label="Scheduling">
              <CalendarClock className="h-6 w-6 text-[hsl(var(--ap-ink2))]" aria-hidden="true" />
              <Big className="mt-3">Schedule it, or send now.</Big>
            </Tile>

            <Tile className="wl-status" label="Post status">
              <Kicker>Every send, accounted for</Kicker>
              <span className="mt-4 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1.5 text-[13px] font-semibold pill-ink-ok">
                  <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" /> Live
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground/[0.07] px-3 py-1.5 text-[13px] font-semibold text-foreground/80">
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> One-tap retry
                </span>
              </span>
            </Tile>

            <Tile className="wl-free" label="Price">
              <Kicker>{beta ? "During beta" : "To start"}</Kicker>
              <p className="mt-1 font-display text-[56px] font-bold leading-none tracking-[-0.04em]">Free</p>
              <p className="mt-2 text-[14px] text-[hsl(var(--ap-ink2))]">No card needed.</p>
            </Tile>

            <Tile className="wl-soon" label="Coming next">
              <Kicker>Coming next</Kicker>
              <span className="mt-4 flex flex-wrap gap-2.5">
                {SOON.map((b) => (
                  <AppIcon key={b} brand={b} size={40} />
                ))}
              </span>
            </Tile>
          </ul>
        </div>
      </section>

      <section id="join" className="scroll-mt-24 px-5 pb-20 pt-10 sm:px-8 sm:pb-28" aria-labelledby="wl-join">
        <div className="mx-auto grid max-w-[1080px] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
          <div className="ap-tile flex flex-col p-6 sm:p-8">
            <Kicker>Join the waitlist</Kicker>
            <h2 id="wl-join" className="mt-1 font-display text-[clamp(1.9rem,4vw,2.6rem)] font-bold leading-[1.05] tracking-[-0.03em]">
              Save your spot.
              <span className="block text-[hsl(var(--ap-ink2))]">We&apos;ll email your invite.</span>
            </h2>
            {counts.total >= 25 && (
              <p className="mt-4 text-[15px] font-semibold text-foreground/80">{counts.total.toLocaleString("en")} creators have joined so far.</p>
            )}
            <ol className="mt-6 grid gap-3 sm:grid-cols-3 lg:mt-auto lg:grid-cols-1 xl:grid-cols-3" aria-label="How the waitlist works">
              {[
                ["Join", "Leave your email. It takes five seconds."],
                ["Get your invite", "We let people in by the order they joined."],
                ["Start posting", "Sign up with that email and bring a video."],
              ].map(([t, b], i) => (
                <li key={t} className="rounded-[20px] bg-[hsl(var(--ap-canvas))] p-4">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-foreground font-display text-[14px] font-bold text-background" aria-hidden="true">{i + 1}</span>
                  <p className="mt-3 font-display text-[17px] font-bold tracking-[-0.015em]">{t}</p>
                  <p className="mt-1 text-[14px] leading-relaxed text-[hsl(var(--ap-ink2))]">{b}</p>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-col">
            <WaitlistForm fromGoogle={searchParams.from === "google"} />
            <p className="mt-4 text-center text-[14px] text-[hsl(var(--ap-ink2))]">
              Already have an account?{" "}
              <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-foreground underline-offset-4 hover:underline">
                Log in<ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
