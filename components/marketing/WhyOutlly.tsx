import { ArrowRight } from "lucide-react";
import { AppIcon } from "@/components/brand/brands";
import { Pip } from "@/components/brand/Pip";
import type { Platform } from "@/lib/domain";
import { USP, type Usp } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";
import { Reveal } from "./Reveal";
import { Shell, SectionHead } from "./bits";
import { SignupCta } from "./SignupCta";

/*
 * Why Outlly (R1180, simplified from the 1161 bento): one larger card for captions and four equal cards beside it.
 * lg: captions takes two of four columns across both rows, the other four sit in a 2 x 2 block. md: captions across
 * the top, then 2 x 2. Phones: one column. Each card is a number, a title, one sentence and at most one small drawing
 * of the real screen. No floating parts, no loops: the grid rises once as it scrolls in (ScrollScenes) and that is all.
 * The call to action follows waitlist mode through SignupCta.
 */

const LIME = "#B5FF00";
const PINE = "#173A24";

function Visual({ id, live }: { id: Usp["id"]; live: readonly Platform[] }) {
  switch (id) {
    case "captions":
      return (
        <div aria-hidden="true" className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 sm:p-5">
          <div className="flex items-center justify-between text-[12px] text-white/60">
            <span>Subtitles</span>
            <span className="tabular-nums">00:04 / 00:12</span>
          </div>
          <p className="mt-3 text-[clamp(1.05rem,0.6vw+0.9rem,1.25rem)] font-semibold leading-snug text-white">
            Every word, <span className="rounded-md px-1.5 py-0.5 text-[#0B0F0C]" style={{ background: LIME }}>timed</span> to your voice.
          </p>
          <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/3 rounded-full" style={{ background: LIME }} />
          </div>
          <p className="mt-3 text-[12px] text-white/60">Telugu, Tamil or Hindi, translated to English</p>
        </div>
      );
    case "publish":
      return (
        <ul className="flex items-center gap-2" aria-label="Platforms you can publish to today">
          {live.map((p) => (
            <li key={p}>
              <AppIcon brand={p} size={32} />
            </li>
          ))}
        </ul>
      );
    case "calendar":
      return (
        <div aria-hidden="true" className="grid grid-cols-7 gap-1.5">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <div key={i} className={cn("grid h-11 place-items-center rounded-xl border text-[12px] font-medium", i === 2 ? "border-transparent text-white" : "border-border text-muted-foreground")} style={i === 2 ? { background: PINE } : undefined}>
              <span>{d}</span>
              <span className={cn("h-1.5 w-1.5 rounded-full", i === 2 ? "" : [0, 4].includes(i) ? "bg-foreground/40" : "bg-transparent")} style={i === 2 ? { background: LIME } : undefined} />
            </div>
          ))}
        </div>
      );
    case "analytics":
      return (
        <div aria-hidden="true" className="flex h-11 items-end gap-1.5">
          {[38, 52, 44, 63, 58, 74, 92].map((h, i, all) => (
            <span key={i} className={cn("flex-1 rounded-md", i === all.length - 1 ? "" : "bg-border")} style={{ height: `${h}%`, ...(i === all.length - 1 ? { background: PINE } : {}) }} />
          ))}
        </div>
      );
    case "pip":
      return (
        <div aria-hidden="true" className="flex items-center gap-3">
          <Pip size={36} mood="idle" className="shrink-0" />
          <p className="rounded-2xl rounded-bl-md border border-border bg-background px-3.5 py-2 text-[13px] leading-snug text-foreground">Ask me what worked best this week.</p>
        </div>
      );
    default:
      return null;
  }
}

export function WhyOutlly({ live }: { live: readonly Platform[] }) {
  const [lead, ...rest]: readonly Usp[] = USP.cards;
  return (
    <section id="why-outlly" className="usp scroll-mt-24 py-16 sm:py-20 lg:py-24" aria-labelledby="usp-title">
      <Shell>
        <SectionHead id="usp-title" eyebrow={USP.eyebrow} title={USP.title} body={USP.body} />

        <div className="usp-grid mt-10 grid gap-4 md:grid-cols-2 lg:mt-12 lg:grid-cols-4 lg:grid-rows-2">
          <article className="usp-card flex flex-col rounded-[1.25rem] p-6 text-white sm:p-8 md:col-span-2 lg:row-span-2" style={{ background: PINE }}>
            <p className="text-[13px] font-semibold tabular-nums" style={{ color: LIME }}>01</p>
            <h3 className="display mt-3 text-[clamp(1.5rem,1.2vw+1.1rem,2rem)]">{lead.title}</h3>
            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-white/75 sm:text-base">{lead.body}</p>
            <div className="mt-8 lg:mt-auto lg:pt-8">
              <Visual id={lead.id} live={live} />
            </div>
          </article>

          {rest.map((c, i) => (
            <article key={c.id} className="usp-card flex flex-col rounded-[1.25rem] border border-border bg-card p-6">
              <p className="text-[13px] font-semibold tabular-nums text-muted-foreground">{String(i + 2).padStart(2, "0")}</p>
              <h3 className="mt-3 text-[1.125rem] font-semibold tracking-tight">{c.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{c.body}</p>
              <div className="mt-auto pt-6">
                <Visual id={c.id} live={live} />
              </div>
            </article>
          ))}
        </div>

        <Reveal fx="depth" className="mt-14 text-center lg:mt-16">
          <h3 className="display text-balance text-[clamp(1.5rem,2vw+0.9rem,2.25rem)]">{USP.cta.title}</h3>
          <p className="mx-auto mt-3 max-w-md text-pretty text-[15px] leading-relaxed text-muted-foreground sm:text-base">{USP.cta.body}</p>
          <div className="mt-7 flex justify-center">
            <SignupCta
              label={USP.cta.label}
              className="group inline-flex h-14 min-w-[12rem] items-center justify-center gap-2 rounded-full bg-lime px-7 text-base font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transform-none"
            >
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
            </SignupCta>
          </div>
        </Reveal>
      </Shell>
    </section>
  );
}
