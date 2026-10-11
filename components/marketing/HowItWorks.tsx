import { Icon3D } from "@/components/brand/Icon3D";
import { Reveal } from "./Reveal";
import { Shell, SectionHead } from "./bits";
import { STEPS } from "@/lib/marketing/content";

export function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-24 pb-20 pt-14 sm:pb-28 sm:pt-20" aria-labelledby="how-title">
      <Shell>
        <SectionHead
          id="how-title"
          eyebrow="How it works"
          title="Three moves, start to published."
          body="The flow is the product. Everything else on this page is a detail of one of these three steps."
        />

        <ol className="mt-14 grid gap-px overflow-hidden rounded-[1.75rem] border border-border bg-border sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.n} className="bg-background p-7 sm:p-8">
              <Reveal delay={i * 0.08}>
                <div className="flex items-start justify-between gap-4">
                  <span className="display text-[2.6rem] text-lime-ink">{s.n}</span>
                  <Icon3D name={s.icon} size={88} className="-mt-1 h-16 w-16 sm:h-20 sm:w-20" />
                </div>
                <h3 className="mt-6 text-xl font-semibold tracking-tight">{s.title}</h3>
                <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">{s.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </Shell>
    </section>
  );
}
