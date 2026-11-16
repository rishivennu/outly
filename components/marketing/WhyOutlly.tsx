import { ArrowRight, Check, Minus } from "lucide-react";
import { AppIcon } from "@/components/brand/brands";
import { Pip } from "@/components/brand/Pip";
import type { Platform } from "@/lib/domain";
import { USP, type Usp } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";
import { Reveal } from "./Reveal";
import { Shell, SectionHead } from "./bits";
import { SignupCta } from "./SignupCta";
import { Stage } from "./usp/Stage";
import { AnalyticsPreview, CalendarPreview, CaptionPreview, InboxPreview, PipPreview, PublishPreview } from "./usp/Previews";

/*
 * Why Outlly (1161): the six strengths right after the hero, as an editorial bento rather than six equal tiles.
 * On lg: captions lead (7 of 12 columns, two rows, ink), publishing and analytics stand beside it, calendar, inbox
 * and Pip close the row underneath. md: two columns, captions across both. Phones: one column.
 * Each panel: kicker, headline, one paragraph, a live preview of the real screen, the honest limit if there is one.
 * Then the with/without comparison and the section's own call to action (SignupCta follows waitlist mode).
 */

/* lg placement is explicit: the DOM keeps the brief's reading order (captions, publishing, calendar, analytics, inbox,
   Pip), while on screen analytics sits under publishing beside the lead and the three small panels share the last row.
   Auto-placement would push Pip onto a fourth row. */
const SPAN: Record<Usp["id"], string> = {
  captions: "md:col-span-2 lg:col-span-7 lg:col-start-1 lg:row-span-2 lg:row-start-1",
  publish: "lg:col-span-5 lg:col-start-8 lg:row-start-1",
  calendar: "lg:col-span-4 lg:col-start-1 lg:row-start-3",
  analytics: "lg:col-span-5 lg:col-start-8 lg:row-start-2",
  inbox: "lg:col-span-4 lg:col-start-5 lg:row-start-3",
  pip: "lg:col-span-4 lg:col-start-9 lg:row-start-3",
};
const FX = { captions: "wipe", publish: "depth", analytics: "depth", calendar: "rise", inbox: "rise", pip: "rise" } as const;

function Preview({ id, live }: { id: Usp["id"]; live: readonly Platform[] }) {
  switch (id) {
    case "captions": return <CaptionPreview />;
    case "publish": return <PublishPreview live={live} />;
    case "calendar": return <CalendarPreview />;
    case "analytics": return <AnalyticsPreview live={live} />;
    case "inbox": return <InboxPreview />;
    case "pip": return <PipPreview />;
    default: return null;
  }
}

export function WhyOutlly({ live, showHow }: { live: readonly Platform[]; showHow: boolean }) {
  const [lead, ...rest]: readonly Usp[] = USP.cards;
  return (
    <section id="why-outlly" className="usp scroll-mt-24 py-16 sm:py-20 lg:py-24" aria-labelledby="usp-title">
      <Shell>
        <SectionHead id="usp-title" eyebrow={USP.eyebrow} title={USP.title} body={USP.body} />

        <Stage className="usp-grid mt-12 grid gap-4 md:grid-cols-2 lg:mt-14 lg:grid-cols-12">
          {/* the lead panel: dark, the caption editor, the one place the lime really burns */}
          <Reveal fx={FX[lead.id]} className={SPAN[lead.id]}>
            <article data-spot="ink" data-flick="" className="usp-card usp-card-ink">
              <div className="relative z-[1] max-w-md">
                <p className="usp-kicker">{lead.kicker}</p>
                <h3 className="display mt-3 text-[clamp(1.5rem,1.4vw+1rem,2.125rem)]">{lead.title}</h3>
                <p className="mt-4 text-[15px] leading-relaxed text-background/70 sm:text-base">{lead.body}</p>
                <ul className="mt-5 flex flex-wrap gap-2">
                  {lead.points.map((p) => (
                    <li key={p} className="usp-point usp-point-ink">{p}</li>
                  ))}
                </ul>
              </div>
              <div className="relative z-[1] mt-8 flex flex-1 flex-col">
                <div className="flick flex flex-1"><CaptionPreview fill /></div>
                {lead.note && <p className="usp-note usp-note-ink">{lead.note}</p>}
              </div>
              <span aria-hidden="true" data-parallax="40" className="usp-orb" />
            </article>
          </Reveal>

          {rest.map((c, i) => (
            <Reveal key={c.id} fx={FX[c.id]} delay={Math.min(i, 4) * 0.05} className={SPAN[c.id]}>
              <article data-spot="" data-flick="" className={cn("usp-card", c.id === "pip" && "usp-card-lime")}>
                <p className="usp-kicker">{c.kicker}</p>
                <h3 className="mt-3 text-[clamp(1.125rem,0.5vw+0.95rem,1.375rem)] font-semibold tracking-tight">{c.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{c.body}</p>
                <div className="mt-6 flex-1">
                  <div className="flick"><Preview id={c.id} live={live} /></div>
                </div>
                {c.id === "publish" && (
                  <ul className="mt-4 flex items-center gap-2" aria-label="Destinations Outlly publishes to today">
                    {live.map((p) => (
                      <li key={p}><AppIcon brand={p} size={28} /></li>
                    ))}
                    <li className="ml-1 text-[12px] text-muted-foreground">publish today</li>
                  </ul>
                )}
                {c.note && <p className="usp-note">{c.note}</p>}
                {c.id === "pip" && <Pip size={88} mood="wave" className="usp-mascot flick hidden sm:block" />}
              </article>
            </Reveal>
          ))}
        </Stage>

        {/* the before and after: a scattered pile of tools against one stack */}
        <div className="mt-16 grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-stretch lg:mt-20" aria-label="Without Outlly and with Outlly">
          <Reveal fx="wipe" dir="right">
            <div className="usp-cmp usp-cmp-without">
              <p className="usp-kicker text-muted-foreground">{USP.compare.without.title}</p>
              <ul className="mt-5 space-y-2.5">
                {USP.compare.without.items.map((t, i) => (
                  <li key={t} className="usp-cmp-row usp-cmp-row-off" style={{ ["--i" as string]: i }}>
                    <Minus className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
                    {t}
                  </li>
                ))}
              </ul>
              <span aria-hidden="true" className="usp-scatter">
                {[0, 1, 2, 3, 4].map((i) => <i key={i} style={{ ["--i" as string]: i }} />)}
              </span>
            </div>
          </Reveal>
          <Reveal y={0} className="hidden md:grid md:place-items-center">
            <span className="usp-to" aria-hidden="true"><ArrowRight className="h-4 w-4" /></span>
          </Reveal>
          <Reveal fx="wipe" dir="left">
            <div className="usp-cmp usp-cmp-with">
              <p className="usp-kicker">{USP.compare.with.title}</p>
              <ul className="mt-5 space-y-2.5">
                {USP.compare.with.items.map((t, i) => (
                  <li key={t} className="usp-cmp-row usp-cmp-row-on" style={{ ["--i" as string]: i }}>
                    <span className="usp-check"><Check className="h-3 w-3" aria-hidden="true" /></span>
                    {t}
                  </li>
                ))}
              </ul>
              <span aria-hidden="true" className="usp-stack">
                {[0, 1, 2].map((i) => <i key={i} style={{ ["--i" as string]: i }} />)}
              </span>
            </div>
          </Reveal>
        </div>

        <Reveal fx="depth" className="mt-14 text-center lg:mt-16">
          <h3 className="display text-balance text-[clamp(1.5rem,2vw+0.9rem,2.25rem)]">{USP.cta.title}</h3>
          <p className="mx-auto mt-3 max-w-md text-pretty text-[15px] leading-relaxed text-muted-foreground sm:text-base">{USP.cta.body}</p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <SignupCta
              magnet
              label={USP.cta.label}
              className="lime-glow group inline-flex h-14 min-w-[12rem] items-center justify-center gap-2 rounded-full bg-lime px-7 text-base font-semibold text-[hsl(var(--lime-foreground))] transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 motion-reduce:transform-none"
            >
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
            </SignupCta>
            {showHow && (
              <a href="#how" className="inline-flex h-14 items-center justify-center rounded-full border border-border px-6 text-base font-medium transition-colors duration-200 hover:bg-muted">
                See how it works
              </a>
            )}
          </div>
        </Reveal>
      </Shell>
    </section>
  );
}
