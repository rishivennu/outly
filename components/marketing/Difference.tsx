import { Icon3D } from "@/components/brand/Icon3D";
import { Reveal } from "./Reveal";
import { Shell, SectionHead } from "./bits";
import { DIFFERENTIATION } from "@/lib/marketing/content";

/** The pitch as a pile of stickers: they pop in with a spring when scrolled to and can be knocked about with the cursor. */
const STICKERS: { label: string; tone: string; r: number }[] = [
  { label: "Upload once", tone: "stk-lime", r: -6 },
  { label: "AI captions", tone: "stk-purple", r: 4 },
  { label: "Reels \u00b7 Shorts \u00b7 X", tone: "stk-ink", r: -2 },
  { label: "Status per post", tone: "stk-pink", r: 5 },
  { label: "Free in beta", tone: "stk-blue", r: -4 },
];

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
            <Reveal y={0} className="stk-wrap mt-10">
              <ul aria-label="Outlly in short" className="flex max-w-md flex-wrap items-center gap-x-1 gap-y-2">
                {STICKERS.map((s, i) => (
                  <li
                    key={s.label}
                    data-flick=""
                    className={`stk flick ${s.tone}`}
                    style={{ ["--si" as string]: i, ["--sr" as string]: `${s.r}deg`, ["--s0" as string]: `${(i % 2 ? 1 : -1) * (22 + i * 4)}deg` }}
                  >
                    {s.label}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <ul className="divide-y divide-border border-y border-border">
            {DIFFERENTIATION.points.map((p, i) => (
              <li key={p.title}>
                <Reveal delay={i * 0.05}>
                  <div data-flick="" className="flex items-start gap-5 py-6">
                    <Icon3D name={p.icon} size={72} className="pop-in flick h-12 w-12 shrink-0" />
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
