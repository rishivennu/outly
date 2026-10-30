import { Icon3D } from "@/components/brand/Icon3D";
import { Reveal } from "./Reveal";
import { Shell, SectionHead } from "./bits";
import { FEATURES } from "@/lib/marketing/content";

export function Features() {
  const [lead, ...rest] = FEATURES;
  return (
    <section id="features" className="scroll-mt-24 py-16 sm:py-20" aria-labelledby="features-title">
      <Shell>
        <SectionHead
          id="features-title"
          eyebrow="What you get"
          title="Everything the second and third upload would have cost you."
        />

        <div className="mt-14 grid gap-4 lg:grid-cols-3">
          {/* the lead feature carries the weight; the rest are quiet siblings */}
          <Reveal fx="wipe" className="lg:col-span-2">
            <article data-flick="" data-spot="ink" className="relative flex h-full flex-col justify-between overflow-hidden rounded-[1.75rem] bg-foreground p-8 text-background sm:p-10">
              <div className="max-w-md">
                <h3 className="display text-[clamp(1.375rem,1.6vw+0.75rem,1.75rem)]">{lead.title}</h3>
                <p className="mt-4 text-[15px] leading-relaxed text-background/70 sm:text-base">{lead.body}</p>
              </div>
              <Icon3D name={lead.icon} size={160} className="pop-in flick mt-8 h-24 w-24 self-start sm:h-32 sm:w-32" />
              <span
                aria-hidden="true"
                data-parallax="36"
                className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[radial-gradient(circle,hsl(var(--lime)/0.35),transparent_65%)]"
              />
            </article>
          </Reveal>

          {rest.map((f, i) => (
            <Reveal key={f.title} fx="depth" delay={Math.min(i, 3) * 0.05}>
              <article data-flick="" data-spot="" className="flex h-full flex-col rounded-[1.75rem] border border-border p-7">
                <Icon3D name={f.icon} size={80} className="pop-in flick h-14 w-14" />
                <h3 className="mt-6 text-[17px] font-semibold tracking-tight">{f.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{f.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </Shell>
    </section>
  );
}
