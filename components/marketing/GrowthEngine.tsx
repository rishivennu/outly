import { RotateCcw } from "lucide-react";
import { Icon3D } from "@/components/brand/Icon3D";
import { ScrambleText } from "@/components/ui/text-fx";
import { GrowthLoop } from "./GrowthLoop";
import { Reveal } from "./Reveal";
import { Shell } from "./bits";
import { splitWords } from "./Split";
import { GROWTH_EXAMPLES } from "./growth/Examples";
import { GROWTH, GROWTH_BLOCKS, type GrowthBlock } from "@/lib/marketing/content";

/**
 * R1263: the section head is SectionHead's markup (rv-head, rv-eyebrow, rv-words, rv-body, so the Play pass in
 * globals.css still runs it) at a larger size than other sections, with each sentence of the title on its own line.
 */
function Head() {
  const [first, ...rest] = GROWTH.title.split(/(?<=\.)\s+/);
  const a = splitWords(first);
  const b = splitWords(rest.join(" "), a.next);
  return (
    <Reveal y={0} className="rv-head grid gap-y-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-end lg:gap-x-16">
      <p className="rv-eyebrow eyebrow flex items-center gap-2.5 lg:col-span-2">
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />
        <ScrambleText text={GROWTH.eyebrow} />
      </p>
      <h2 id="growth-title" className="display text-[clamp(1.95rem,2.9vw+1.15rem,3.5rem)] leading-[1.04]">
        <span className="rv-words">
          <span className="block text-balance">{a.nodes}</span>{" "}
          <span className="block text-balance">{b.nodes}</span>
        </span>
      </h2>
      <p className="rv-body rv-kw max-w-[60ch] text-pretty text-base leading-[1.6] text-muted-foreground sm:text-[17px] lg:pb-1.5">{splitWords(GROWTH.body).nodes}</p>
    </Reveal>
  );
}

/**
 * One track behind all four steps (ge-track, its lime ge-track-fill draws in) and a node per step. The ol is a grid
 * and the track is a grid item, so it starts and ends on the first and last node at every width (globals.css R1263).
 * GrowthLoop owns the motion; the markup stays server-rendered.
 */
function Workflow() {
  return (
    <GrowthLoop className="mt-12 sm:mt-14">
      <ol className="ge-steps" aria-label="The growth loop">
        <li aria-hidden="true" className="ge-track">
          <span className="ge-track-fill" />
        </li>
        {GROWTH.loop.map((s, i) => (
          <li key={s.label} className="ge-step" style={{ ["--i" as string]: i, ["--n" as string]: i + 1 }}>
            <span aria-hidden="true" className="ge-node">
              <span className="ge-node-lit" />
            </span>
            <span className="min-w-0">
              <span className="ge-label block text-[13px] font-semibold uppercase leading-5 tracking-[0.12em]">{s.label}</span>
              <span className="ge-hint mt-1 block text-pretty text-[14px] leading-[1.5] text-muted-foreground">{s.hint}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="ge-note mt-8 flex items-start gap-2 text-[14px] leading-relaxed text-muted-foreground sm:justify-center sm:text-center">
        <RotateCcw aria-hidden="true" className="ge-return mt-[0.2em] h-4 w-4 shrink-0 text-lime-ink" />
        {GROWTH.loopNote}
      </p>
    </GrowthLoop>
  );
}

/**
 * Card anatomy: name, title and body / bullets / example. From md the li and the article are subgrids of the list's
 * rows, so the bullets and the examples start on the same line across a row and both cards share one height.
 */
function Card({ b }: { b: GrowthBlock }) {
  const Example = GROWTH_EXAMPLES[b.id];
  return (
    <li className="flex md:row-span-3 md:grid md:grid-rows-subgrid">
      <article
        data-flick=""
        data-spot=""
        aria-labelledby={`ge-${b.id}`}
        className="ge-card flex w-full flex-col gap-6 rounded-[1.75rem] border border-border bg-card p-6 transition-[transform,box-shadow] duration-200 ease-out motion-reduce:transition-none sm:p-8 md:row-span-3 md:p-6 lg:p-8 md:grid md:grid-rows-subgrid motion-safe:[@media(hover:hover)]:hover:-translate-y-1"
      >
        <div>
          <div className="flex items-center gap-3">
            <Icon3D name={b.icon} size={80} className="pop-in flick h-11 w-11 shrink-0" />
            <p className="text-[13px] font-semibold tracking-tight text-lime-ink">{b.name}</p>
          </div>
          <h3 id={`ge-${b.id}`} className="mt-5 text-[clamp(1.25rem,0.6vw+1.05rem,1.5rem)] font-semibold leading-[1.2] tracking-[-0.02em]">{b.title}</h3>
          <p className="mt-3 max-w-[60ch] text-pretty text-[15px] leading-relaxed text-muted-foreground sm:text-base">{b.body}</p>
        </div>
        <ul className="grid content-start gap-2.5 text-[14px] leading-[1.5]">
          {b.bullets.map((x) => (
            <li key={x.label} className="flex items-start gap-2.5">
              <span aria-hidden="true" className="mt-[0.5em] h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />
              <span className="min-w-0">
                {x.label}
                {x.note && <span className="text-muted-foreground"> ({x.note})</span>}
                {x.soon && <span className="lt-soon ml-2 whitespace-nowrap">Coming soon</span>}
              </span>
            </li>
          ))}
        </ul>
        <Example />
      </article>
    </li>
  );
}

/** R1261, refined in R1263: the Content Growth Engine. The loop first, then one card per part of it, all live unless tagged. */
export function GrowthEngine() {
  return (
    <section id="growth" className="scroll-mt-24 py-16 sm:py-20" aria-labelledby="growth-title">
      <Shell>
        <Head />
        <Workflow />
        <Reveal as="ul" stagger className="mt-12 grid gap-5 sm:mt-14 md:grid-cols-2 md:gap-6">
          {GROWTH_BLOCKS.map((b) => (
            <Card key={b.id} b={b} />
          ))}
        </Reveal>
      </Shell>
    </section>
  );
}
