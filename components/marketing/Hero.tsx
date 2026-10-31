import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HeroFan, HeroProps, CursorTag, Sparkles } from "./HeroFan";
import { SignupCta } from "./SignupCta";
import { StampChip } from "@/components/brand/Stamps";
import { Shell } from "./bits";
import { splitWords } from "./Split";
import { HERO } from "@/lib/marketing/content";
import { ScrambleText } from "@/components/ui/text-fx";
import type { Platform } from "@/lib/domain";

/**
 * Hero: centred pill eyebrow, a two-line headline in a soft silver gradient with the serif
 * accent, collaborator name tags floating beside it, then the arched card fan rising from
 * the bottom edge. Works in both themes; the fan cards keep their own saturated colours.
 */
// `live` is still accepted, but the platform list lives in the "Publishes to" ticker right below (1063 trimmed the hero).
export function Hero({ showHow = true, beta = false }: { showHow?: boolean; beta?: boolean; live?: Platform[] }) {
  // Words unfold one after another on load (Play pass in globals.css); the accent word is written in last.
  const l1 = splitWords("Your content deserves");
  const l2 = splitWords("to be", l1.next);
  return (
    <section className="relative overflow-hidden pb-0 pt-8 sm:pt-10" aria-labelledby="hero-title">
      <div aria-hidden="true" className="hf-glow pointer-events-none absolute inset-0" />
      {/* a soft light that trails the mouse behind the headline (LandingFx) */}
      <div aria-hidden="true" className="hf-aura" />
      <Sparkles />
      <Shell className="relative flex flex-col items-center text-center">
        <HeroProps />
        <div className="relative w-full">
          <CursorTag name="Meera" tone="teal" side="l" className="left-[2%] top-[4%] hidden md:inline-flex lg:left-[8%]" />
          <CursorTag name="Arjun" tone="pink" side="r" className="right-[2%] top-[58%] hidden md:inline-flex lg:right-[8%]" />
          {/* 10.98em is the old 17ch measured in Manrope. ch follows the font, so it changed when the web font swapped in and the headline briefly wrapped to three lines (1064). */}
          <h1 id="hero-title" className="display hf-h1 mx-auto max-w-[10.98em] text-balance text-[clamp(2.375rem,4.2vw+0.5rem,3.5rem)]">
            <span className="hf-line is-split">{l1.nodes}</span>{" "}
            <span className="hf-line is-split">
              {l2.nodes} <span className="accent-serif hf-accent sw" style={{ ["--wi" as string]: l2.next }}>everywhere.</span>
            </span>
          </h1>
        </div>
        {/* 1069: the line arrives word by word, each one rising out of a blur (kinetic words) */}
        <p className="hf-kw mt-4 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-[17px]" style={{ ["--d" as string]: ".55s" }}>
          {splitWords(HERO.sub).nodes}
        </p>

        <div className="hf-cta mt-5 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center" style={{ ["--d" as string]: ".8s" }}>
          <SignupCta
            magnet
            label={HERO.primary.label}
            className="lime-glow group inline-flex h-14 items-center justify-center gap-2 rounded-full bg-lime px-7 text-base font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 hover:-translate-y-0.5 active:scale-[0.97]"
          >
            <ArrowRight className="h-[18px] w-[18px] transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
          </SignupCta>
          {showHow && <Link
            data-magnet=""
            data-lens=""
            href={HERO.secondary.href}
            className="glass hairline inline-flex h-14 items-center justify-center rounded-full px-6 text-base font-medium transition-colors hover:bg-secondary"
          >
            {HERO.secondary.label}
          </Link>}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-center">
        <p data-lens="" className="hf-in glass hairline inline-flex items-center gap-2 rounded-full py-1.5 pl-2 pr-4 text-[13px] font-medium text-foreground/85" style={{ ["--d" as string]: ".85s" }}>
          {beta ? (
            <>
              <StampChip>Beta</StampChip>
              <span className="text-lime-ink dark:text-lime">Free during beta</span>
              {/* the long half only where it fits on one line */}
              <span aria-hidden="true" className="hidden text-foreground/40 sm:inline">&middot;</span>
              <span className="hidden sm:inline"><ScrambleText text={HERO.eyebrow} /></span>
            </>
          ) : (
            <>
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-lime" />
              <ScrambleText text={HERO.eyebrow} />
            </>
          )}
        </p>

        </div>
      </Shell>

      {/* Never catches clicks: the fan's negative top margin lifts this wrapper over the copy above. */}
      <div className="pointer-events-none relative mt-2 sm:mt-3">
        <HeroFan framed />
      </div>
    </section>
  );
}
