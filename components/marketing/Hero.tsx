import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HeroStage } from "./HeroStage";
import { Shell } from "./bits";
import { HERO, PLATFORM_PITCH } from "@/lib/marketing/content";

export function Hero() {
  return (
    <section className="relative overflow-hidden pb-4 pt-10 sm:pt-16" aria-labelledby="hero-title">
      <div aria-hidden="true" className="hero-glow pointer-events-none absolute inset-0" />
      <Shell className="relative flex flex-col items-center text-center">
        <p className="glass hairline inline-flex items-center gap-2 rounded-full py-1.5 pl-2 pr-4 text-[13px] font-medium text-foreground/85">
          <span className="rounded-full bg-lime px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--lime-foreground))]">Beta</span>
          {HERO.eyebrow}
        </p>
        <h1 id="hero-title" className="display mt-7 max-w-[15ch] text-balance text-[clamp(2.9rem,8vw,6.25rem)]">
          Your content deserves to be <span className="accent-serif text-lime-ink dark:text-lime">everywhere.</span>
        </h1>
        <p className="mt-6 max-w-xl text-pretty text-[17px] leading-relaxed text-muted-foreground sm:text-[19px]">{HERO.sub}</p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={HERO.primary.href}
            className="lime-glow group inline-flex h-14 items-center gap-2 rounded-full bg-lime px-7 text-base font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 hover:-translate-y-0.5 active:scale-[0.97]"
          >
            {HERO.primary.label}
            <ArrowRight className="h-[18px] w-[18px] transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
          <Link
            href={HERO.secondary.href}
            className="glass hairline inline-flex h-14 items-center rounded-full px-6 text-base font-medium transition-colors hover:bg-secondary"
          >
            {HERO.secondary.label}
          </Link>
        </div>

        <dl className="mt-8 flex flex-wrap justify-center gap-x-7 gap-y-3">
          {PLATFORM_PITCH.map((p) => (
            <div key={p.id} className="flex items-baseline gap-1.5">
              <dt className="text-sm font-semibold">{p.name}</dt>
              <dd className="text-sm text-muted-foreground">{p.format}</dd>
            </div>
          ))}
          <div className="flex items-baseline gap-1.5">
            <dt className="text-sm font-semibold text-lime-ink dark:text-lime">Free</dt>
            <dd className="text-sm text-muted-foreground">during beta</dd>
          </div>
        </dl>
      </Shell>

      <div className="relative mt-6 sm:mt-10">
        <HeroStage />
      </div>
    </section>
  );
}
