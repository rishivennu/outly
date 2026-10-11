import Link from "next/link";
import { Check } from "lucide-react";
import { Shell, SectionHead } from "./bits";
import { PLANS, PRICING_NOTE } from "@/lib/marketing/content";
import { Reveal } from "./Reveal";
import { cn } from "@/lib/utils";

export function Pricing() {
  return (
    <section id="pricing" className="scroll-mt-24 py-20 sm:py-28" aria-labelledby="pricing-title">
      <Shell>
        <SectionHead
          id="pricing-title"
          align="center"
          eyebrow="Pricing"
          title="Free while we are in beta."
          body={PRICING_NOTE}
        />

        <Reveal as="ul" stagger className="mt-14 grid gap-4 md:grid-cols-3">
          {PLANS.map((p) => {
            const live = p.state === "available";
            return (
              <li key={p.name}>
                <article
                  className={cn(
                    "flex h-full flex-col rounded-[1.75rem] p-7 sm:p-8",
                    live ? "border-2 border-lime bg-lime/[0.07]" : "border border-border",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xl font-semibold tracking-tight">{p.name}</h3>
                    {!live && (
                      <span className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Soon
                      </span>
                    )}
                  </div>
                  <p className={cn("mt-5 text-[1.6rem] font-semibold tracking-tightest", live ? "text-lime-ink" : "text-muted-foreground")}>
                    {p.price}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{p.note}</p>

                  <ul className="mt-7 flex flex-1 flex-col gap-3">
                    {p.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2.5 text-[15px] leading-snug">
                        <Check className={cn("mt-0.5 h-4 w-4 shrink-0", live ? "text-lime-ink" : "text-muted-foreground")} aria-hidden="true" />
                        <span className={live ? undefined : "text-muted-foreground"}>{b}</span>
                      </li>
                    ))}
                  </ul>

                  {live ? (
                    <Link
                      href="/signup"
                      className="lime-glow mt-8 inline-flex h-12 items-center justify-center rounded-full bg-lime px-6 text-sm font-semibold text-[hsl(var(--lime-foreground))] transition-transform active:scale-[0.97]"
                    >
                      Start creating
                    </Link>
                  ) : (
                    <p className="mt-8 text-[13px] leading-relaxed text-muted-foreground">
                      Not on sale yet. Nothing changes for beta accounts without notice.
                    </p>
                  )}
                </article>
              </li>
            );
          })}
        </Reveal>
      </Shell>
    </section>
  );
}
