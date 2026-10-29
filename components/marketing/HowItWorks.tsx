import { Icon3D } from "@/components/brand/Icon3D";
import { Reveal } from "./Reveal";
import { Shell, SectionHead } from "./bits";
import { STEPS } from "@/lib/marketing/content";

export function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-24 pb-16 pt-14 sm:pb-20 sm:pt-20" aria-labelledby="how-title">
      <Shell>
        <SectionHead
          id="how-title"
          eyebrow="How it works"
          title="Three moves, start to published."
          body="The flow is the product. Everything else on this page is a detail of one of these three steps."
        />

        {/* On wide screens the section pins and the rail fills as each step lights up in turn (ScrollScenes.tsx). Decorative. */}
        <div aria-hidden="true" className="how-rail mt-14 hidden lg:block">
          <span className="how-fill" />
          {STEPS.map((s, i) => (
            <span key={s.n} className="how-node" style={{ left: `${(i + 0.5) * (100 / STEPS.length)}%` }} />
          ))}
        </div>
        <ol className="mt-14 grid gap-px overflow-hidden rounded-[1.75rem] border border-border bg-border sm:grid-cols-3 lg:mt-5">
          {STEPS.map((s, i) => (
            <li key={s.n} data-flick="" data-spot="" className="how-step bg-background p-7 sm:p-8">
              <Reveal delay={i * 0.08}>
                <span className="how-n display block text-[2.6rem] text-lime-ink">{s.n}</span>
                <div className="mt-4 flex items-center gap-3">
                  <Icon3D name={s.icon} size={88} className="pop-in flick h-12 w-12 shrink-0 sm:h-14 sm:w-14" />
                  <h3 className="text-xl font-semibold tracking-tight">{s.title}</h3>
                </div>
                <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">{s.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </Shell>
    </section>
  );
}
