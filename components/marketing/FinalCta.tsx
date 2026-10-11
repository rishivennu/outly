import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Icon3D } from "@/components/brand/Icon3D";
import { StampCluster } from "@/components/brand/Stamps";
import { Shell } from "./bits";
import { Reveal } from "./Reveal";
import { FINAL_CTA } from "@/lib/marketing/content";

export function FinalCta() {
  return (
    <section className="pb-24 pt-10 sm:pb-32" aria-labelledby="cta-title">
      <Shell>
        <Reveal y={40}>
        <div className="relative overflow-hidden rounded-[2.25rem] bg-foreground px-7 py-14 text-background sm:px-14 sm:py-20">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,hsl(var(--lime)/0.4),transparent_65%)]"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-28 -right-16 h-80 w-80 rounded-full bg-[radial-gradient(circle,hsl(var(--pink)/0.3),transparent_65%)]"
          />
          <StampCluster className="pointer-events-none absolute -right-6 top-8 hidden w-[340px] md:block lg:right-6 lg:top-1/2 lg:w-[400px] lg:-translate-y-1/2" />
          <Reveal stagger y={20} className="relative max-w-2xl md:max-w-[52%] lg:max-w-[50%]">
            <Icon3D name="celebration" size={128} className="h-20 w-20" />
            <h2 id="cta-title" className="display mt-7 text-balance text-[clamp(2.1rem,5.6vw,3.75rem)]">
              {FINAL_CTA.title}
            </h2>
            <p className="mt-5 max-w-xl text-pretty text-[17px] leading-relaxed text-background/70 sm:text-lg">{FINAL_CTA.body}</p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/signup"
                className="inline-flex h-14 items-center gap-2 rounded-full bg-lime px-7 text-base font-semibold text-[hsl(var(--lime-foreground))] transition-transform active:scale-[0.97]"
              >
                Start creating
                <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
              </Link>
              <Link
                href="/login"
                className="inline-flex h-14 items-center rounded-full border border-background/25 px-6 text-base font-medium text-background transition-colors hover:bg-background/10"
              >
                Log in
              </Link>
            </div>
          </Reveal>
        </div>
        </Reveal>
      </Shell>
    </section>
  );
}
