import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrambleText } from "@/components/ui/text-fx";
import { pixelFont } from "@/components/workshops/fonts";
import { ENGINE } from "@/lib/marketing/content";
import { Reveal } from "./Reveal";
import { SignupCta } from "./SignupCta";
import { Shell } from "./bits";
import { EngineCard } from "./intelligence/EngineCard";
import { EngineStage } from "./intelligence/EngineStage";

/**
 * R1341: the Intelligence Engine, the core of the product, as a kiln: a dark stage whose top half is a live field of
 * glowing pixels (HeatField, canvas) spelling the word the headline ends on, dripping down towards the headline. The
 * right card lists the engine's four parts; the glass window says what it learns from. Copy is lib/marketing/content.ts
 * ENGINE, pinned to the engine's own claims. The section is server-rendered; EngineStage and EngineCard add the motion.
 */
export function IntelligenceEngine({ showGrowth = true }: { showGrowth?: boolean }) {
  const [first, second] = ENGINE.title;
  const words = second.split(" ");
  const last = words.pop() ?? "";
  const lead = words.join(" ");
  return (
    <section id="intelligence" className="scroll-mt-24 py-16 sm:py-20" aria-labelledby="engine-title">
      <Shell>
        <Reveal y={0}>
          <p className="eyebrow mb-5 flex items-center gap-2.5">
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />
            <ScrambleText text={ENGINE.eyebrow} />
          </p>
        </Reveal>

        <EngineStage word={ENGINE.spell} alt={ENGINE.alt}>
          <div className="relative grid gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)] lg:gap-x-12">
            {/* The glass window: what the engine learns from. Phones keep the room for the field itself. */}
            <div className="ek-rise ek-glass hidden w-fit max-w-[18rem] self-start rounded-2xl px-4 py-3 sm:block lg:col-start-1 lg:row-start-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">{ENGINE.learns.title}</p>
              <p className="mt-1 text-pretty text-[13px] leading-[1.5] text-white/80">{ENGINE.learns.body}</p>
            </div>

            {/* The headline block: the field ends 32 px above it (EngineStage measures this element). */}
            <div data-ek-head="" className="relative mt-[250px] self-end sm:mt-[230px] lg:col-start-1 lg:row-start-2 lg:mt-[270px]">
              <h2 id="engine-title" className="display text-balance text-[clamp(2rem,3vw+1.05rem,3.75rem)] leading-[1.02]">
                <span className="ek-rise block">{first}</span>
                <span className="ek-rise block">
                  {lead} <span className={cn(pixelFont.className, "ek-pixel")}>{last}</span>
                </span>
              </h2>
              <p className="ek-rise mt-5 max-w-[56ch] text-pretty text-[15px] leading-[1.6] text-white/75 sm:text-base">{ENGINE.body}</p>
            </div>

            {/* The card: below the headline on phones, the right column on desktop (pushed under the controls). */}
            <div className="ek-rise relative lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:self-end lg:pt-20">
              <EngineCard title="How it works" status="Learning" parts={ENGINE.parts} note={ENGINE.accuracy} />
            </div>
          </div>
        </EngineStage>

        <Reveal className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <ul className="grid gap-3 text-pretty text-[14px] leading-[1.55] text-muted-foreground sm:grid-cols-2 sm:gap-6">
            <li className="flex items-start gap-2.5">
              <span aria-hidden="true" className="mt-[0.5em] h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />
              {ENGINE.plans}
            </li>
            <li className="flex items-start gap-2.5">
              <span aria-hidden="true" className="mt-[0.5em] h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />
              {ENGINE.sharing}
            </li>
          </ul>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <SignupCta
              label={ENGINE.primary.label}
              className="lime-glow group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-lime px-6 text-[15px] font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 hover:-translate-y-0.5 active:scale-[0.97] motion-reduce:transition-none"
            >
              <ArrowRight className="h-[18px] w-[18px] transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
            </SignupCta>
            {showGrowth && (
              <Link href={ENGINE.secondary.href} className="glass hairline inline-flex h-12 items-center justify-center rounded-full px-5 text-[15px] font-medium transition-colors hover:bg-secondary">
                {ENGINE.secondary.label}
              </Link>
            )}
          </div>
        </Reveal>
      </Shell>
    </section>
  );
}
