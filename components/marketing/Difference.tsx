import { Icon3D } from "@/components/brand/Icon3D";
import { Reveal } from "./Reveal";
import { Shell, SectionHead } from "./bits";
import { DIFFERENTIATION } from "@/lib/marketing/content";

export function Difference() {
  return (
    <section id="why" className="scroll-mt-24 py-20 sm:py-28" aria-labelledby="why-title">
      <Shell>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-16">
          <div>
            <SectionHead id="why-title" eyebrow={DIFFERENTIATION.eyebrow} title={DIFFERENTIATION.title} body={DIFFERENTIATION.body} />
            <p className="mt-7 max-w-md border-l-2 border-lime pl-4 text-[15px] leading-relaxed text-muted-foreground">
              {DIFFERENTIATION.honest}
            </p>
          </div>

          <ul className="divide-y divide-border border-y border-border">
            {DIFFERENTIATION.points.map((p, i) => (
              <li key={p.title}>
                <Reveal delay={i * 0.05}>
                  <div className="flex items-start gap-5 py-6">
                    <Icon3D name={p.icon} size={72} className="h-12 w-12 shrink-0" />
                    <div>
                      <h3 className="text-[17px] font-semibold tracking-tight">{p.title}</h3>
                      <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{p.body}</p>
                    </div>
                  </div>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </Shell>
    </section>
  );
}
