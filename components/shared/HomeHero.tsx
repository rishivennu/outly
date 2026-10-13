"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CalendarClock } from "lucide-react";
import { HeroFan, CursorTag, Sparkles, type FanCard } from "@/components/marketing/HeroFan";
import { UploadZone } from "./UploadZone";
import { handoffFile } from "@/lib/client/handoff";
import { Greeting } from "./Greeting";

/*
 * Studio home hero, built from the landing hero's parts: the glow, sparkles, a pill eyebrow
 * (here the live greeting), the silver two-line headline with the gradient serif accent,
 * collaborator name tags (the creator and Pip), and the arched card fan. The fan's centre
 * pill goes to /create instead of sign-up. The upload drop zone stays right below it.
 */
const STUDIO_CARDS: FanCard[] = [
  { key: "ideas", title: "Ideas", sub: "Hooks that land", icon: "generate-ideas", tone: "hf-purple", rot: -15, y: 96, hideSm: true },
  { key: "ig", title: "Reels", sub: "Caption, tailored", icon: "hashtags", tone: "hf-pink", platform: "instagram", rot: -8, y: 34 },
  { key: "you", title: "Next video", sub: "Upload once", icon: "create", tone: "hf-lime", rot: 0, y: 0 },
  { key: "yt", title: "Shorts", sub: "Title, tailored", icon: "hook-generator", tone: "hf-red", platform: "youtube", rot: 8, y: 34 },
  { key: "plan", title: "Schedule", sub: "Best time, picked", icon: "schedule", tone: "hf-blue", rot: 15, y: 96, hideSm: true },
];

export function HomeHero({ firstName }: { firstName: string }) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const tag = (firstName || "You").slice(0, 14);
  return (
    <section className="relative overflow-hidden pb-14" aria-labelledby="home-title">
      {/* the glow stops where the fan fades out, so the fade lands on plain background (no seam) */}
      <div className="relative pt-8 sm:pt-12">
        <div aria-hidden="true" className="hf-glow pointer-events-none absolute inset-0" />
        <Sparkles />
        <div className="relative mx-auto flex max-w-6xl flex-col items-center px-5 text-center sm:px-10">
          <Greeting name={firstName} className="hf-rise-in" />

          <div className="relative mt-7 w-full">
            <CursorTag name={tag} tone="teal" side="l" className="left-[2%] top-[6%] hidden md:inline-flex lg:left-[6%]" />
            <CursorTag name="Pip" tone="pink" side="r" className="right-[2%] top-[60%] hidden md:inline-flex lg:right-[8%]" />
            <h1 id="home-title" className="display hf-h1 mx-auto max-w-[15ch] text-balance text-[clamp(2.5rem,7vw,5.4rem)]">
              <span className="hf-line">What are we</span>{" "}
              <span className="hf-line">
                <span className="accent-serif hf-accent">creating</span> today?
              </span>
            </h1>
          </div>
          <p className="mt-6 max-w-lg text-pretty text-[17px] leading-relaxed text-muted-foreground sm:text-[19px]">
            One video. Every platform. Zero chaos.
          </p>

          <div className="mt-8 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
            <Link
              href="/create"
              className="lime-glow group inline-flex h-14 items-center justify-center gap-2 rounded-full bg-lime px-7 text-base font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 hover:-translate-y-0.5 active:scale-[0.97]"
            >
              Create something
              <ArrowRight className="h-[18px] w-[18px] transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
            <Link
              href="/calendar"
              className="glass hairline inline-flex h-14 items-center justify-center gap-2 rounded-full px-6 text-base font-medium transition-colors hover:bg-secondary"
            >
              <CalendarClock className="h-[18px] w-[18px]" aria-hidden="true" /> Open calendar
            </Link>
          </div>
        </div>

        <div className="relative mt-4 sm:mt-6">
          <HeroFan cards={STUDIO_CARDS} cta={{ href: "/create", label: "Create something" }} />
        </div>
      </div>

      <div className="relative mx-auto mt-6 max-w-6xl px-5 sm:px-10">
        <p className="mb-4 text-center text-sm text-muted-foreground">…or drop a video you already have.</p>
        <UploadZone
          accepted={accepted}
          onFile={(f) => {
            handoffFile(f);
            setAccepted(true);
            router.prefetch("/create");
            setTimeout(() => router.push("/create"), 650);
          }}
        />
      </div>
    </section>
  );
}
