import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HeroFan, CursorTag, Sparkles } from "./HeroFan";
import { SignupCta } from "./SignupCta";
import { StampChip } from "@/components/brand/Stamps";
import { Shell } from "./bits";
import { splitWords } from "./Split";
import { HERO, PLATFORM_PITCH } from "@/lib/marketing/content";

/**
 * Hero: centred pill eyebrow, a two-line headline in a soft silver gradient with the serif
 * accent, collaborator name tags floating beside it, then the arched card fan rising from
 * the bottom edge. Works in both themes; the fan cards keep their own saturated colours.
 */
export function Hero({ showHow = true }: { showHow?: boolean }) {
  // Words unfold one after another on load (Play pass in globals.css); the accent word is written in last.
  const l1 = splitWords("Your content deserves");
  const l2 = splitWords("to be", l1.next);
  return (
    <section className="relative overflow-hidden pb-4 pt-10 sm:pt-16" aria-labelledby="hero-title">
      <div aria-hidden="true" className="hf-glow pointer-events-none absolute inset-0" />
      <Sparkles />
      <Shell className="relative flex flex-col items-center text-center">
        <p className="hf-in glass hairline inline-flex items-center gap-2 rounded-full py-1.5 pl-2 pr-4 text-[13px] font-medium text-foreground/85">
          <StampChip>Beta</StampChip>
          <span className="text-lime-ink dark:text-lime">Free during beta</span>
          {/* the long half only where it fits on one line */}
          <span aria-hidden="true" className="hidden text-foreground/40 sm:inline">&mdash;</span>
          <span className="hidden sm:inline">{HERO.eyebrow}</span>
        </p>

        <div className="relative mt-7 w-full">
          <CursorTag name="Meera" tone="teal" side="l" className="left-[2%] top-[4%] hidden md:inline-flex lg:left-[8%]" />
          <CursorTag name="Arjun" tone="pink" side="r" className="right-[2%] top-[58%] hidden md:inline-flex lg:right-[8%]" />
          <h1 id="hero-title" className="display hf-h1 mx-auto max-w-[17ch] text-balance text-[clamp(2.6rem,7.2vw,5.6rem)]">
            <span className="hf-line is-split">{l1.nodes}</span>{" "}
            <span className="hf-line is-split">
              {l2.nodes} <span className="accent-serif hf-accent sw" style={{ ["--wi" as string]: l2.next }}>everywhere.</span>
            </span>
          </h1>
        </div>
        <p className="hf-in mt-6 max-w-xl text-pretty text-[17px] leading-relaxed text-muted-foreground sm:text-[19px]" style={{ ["--d" as string]: ".7s" }}>
          {HERO.sub}
        </p>

        <div className="hf-in mt-8 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center" style={{ ["--d" as string]: ".8s" }}>
          <SignupCta
            label={HERO.primary.label}
            className="lime-glow group inline-flex h-14 items-center justify-center gap-2 rounded-full bg-lime px-7 text-base font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 hover:-translate-y-0.5 active:scale-[0.97]"
          >
            <ArrowRight className="h-[18px] w-[18px] transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
          </SignupCta>
          {showHow && <Link
            href={HERO.secondary.href}
            className="glass hairline inline-flex h-14 items-center justify-center rounded-full px-6 text-base font-medium transition-colors hover:bg-secondary"
          >
            {HERO.secondary.label}
          </Link>}
        </div>

        <dl className="hf-in mt-7 flex flex-wrap justify-center gap-x-7 gap-y-2" style={{ ["--d" as string]: ".9s" }}>
          {PLATFORM_PITCH.map((p) => (
            <div key={p.id} className="flex items-baseline gap-1.5">
              <dt className="text-sm font-semibold">{p.name}</dt>
              <dd className="text-sm text-muted-foreground">{p.format}</dd>
            </div>
          ))}
        </dl>
      </Shell>

      <div className="relative mt-4 sm:mt-6">
        <HeroFan framed />
      </div>
    </section>
  );
}
