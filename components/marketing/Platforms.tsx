import { PlatformGlyph } from "@/components/shared/PlatformIcon";
import { Reveal } from "./Reveal";
import { Shell, SectionHead } from "./bits";
import { PLATFORM_PITCH, COMING_LATER } from "@/lib/marketing/content";

export function Platforms() {
  return (
    <section id="platforms" className="scroll-mt-24 py-20 sm:py-28" aria-labelledby="platforms-title">
      <Shell>
        <SectionHead
          id="platforms-title"
          eyebrow="Supported destinations"
          title="Three places, properly supported."
          body="Each destination gets its own fields, its own limits and its own status. These are the only three Outly publishes to today."
        />

        <ul className="mt-14 grid gap-4 md:grid-cols-3">
          {PLATFORM_PITCH.map((p, i) => (
            <li key={p.id}>
              <Reveal delay={i * 0.06} className="h-full">
                <article className="flex h-full flex-col rounded-[1.75rem] border border-border p-7">
                  <span
                    className="grid h-12 w-12 place-items-center rounded-2xl"
                    style={{ background: `hsl(var(--${p.id}) / 0.14)`, color: `hsl(var(--${p.id}))` }}
                  >
                    <PlatformGlyph platform={p.id} className="h-6 w-6" />
                  </span>
                  <h3 className="mt-6 text-xl font-semibold tracking-tight">
                    {p.name} <span className="font-normal text-muted-foreground">{p.format}</span>
                  </h3>
                  <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">{p.blurb}</p>
                  <p className="mt-auto pt-6 text-[13px] leading-relaxed text-muted-foreground/90">{p.needs}</p>
                </article>
              </Reveal>
            </li>
          ))}
        </ul>

        <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">{COMING_LATER}</p>
      </Shell>
    </section>
  );
}
