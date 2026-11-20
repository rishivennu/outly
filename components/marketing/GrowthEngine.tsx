import { RotateCcw } from "lucide-react";
import { Icon3D } from "@/components/brand/Icon3D";
import { Reveal } from "./Reveal";
import { Shell, SectionHead } from "./bits";
import { GROWTH, GROWTH_BLOCKS, type GrowthBlock } from "@/lib/marketing/content";

// The mini visuals reuse the Intelligence page's own vocabulary (components/intelligence/bits.tsx): the confidence
// badge, platform and format chips, the planner statuses. They are examples, so each one says so.
const CHIP = "rounded-full bg-background/70 px-2.5 py-1 text-xs font-medium hairline";

function Example({ children }: { children: React.ReactNode }) {
  return (
    <div aria-hidden="true" className="ge-viz mt-6 rounded-2xl bg-secondary/40 p-3.5 hairline">
      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Example</p>
      {children}
    </div>
  );
}

function IntelligenceViz() {
  return (
    <Example>
      <p className="text-[14px] font-medium leading-snug">Another how-to Reel</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={CHIP}>Instagram</span>
        <span className={CHIP}>Video</span>
        <span className="inline-flex items-center rounded-full bg-lime px-2.5 py-1 text-xs font-semibold text-[hsl(var(--lime-foreground))] hairline">High confidence</span>
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">Beats your usual Reels on views, like with like.</p>
    </Example>
  );
}

function MemoryViz() {
  const versions = [
    { where: "Instagram Reel", state: "Views tracked" },
    { where: "YouTube Short", state: "Views tracked" },
    { where: "X post", state: "Not provided by X" },
  ];
  return (
    <Example>
      <p className="text-[14px] font-medium leading-snug">Original upload</p>
      <ul className="ge-tree mt-2 grid gap-1.5">
        {versions.map((v) => (
          <li key={v.where} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-background/70 px-3 py-2 text-[13px] hairline">
            <span className="font-medium">{v.where}</span>
            <span className="text-muted-foreground">{v.state}</span>
          </li>
        ))}
      </ul>
    </Example>
  );
}

function AdaptViz() {
  const formats = [
    { label: "Video", where: "Every platform" },
    { label: "Photo", where: "Instagram" },
    { label: "Carousel", where: "Instagram" },
  ];
  return (
    <Example>
      <ul className="flex flex-wrap gap-1.5">
        {formats.map((f) => (
          <li key={f.label} className={CHIP}>
            {f.label} <span className="text-muted-foreground">· {f.where}</span>
          </li>
        ))}
        <li className={CHIP}>
          Text <span className="lt-soon ml-1">Coming soon</span>
        </li>
      </ul>
    </Example>
  );
}

function PlannerViz() {
  const plan = [
    { idea: "Tutorial Reel", status: "Accepted" },
    { idea: "Behind the scenes Short", status: "Saved" },
    { idea: "Carousel recap", status: "Open" },
  ];
  return (
    <Example>
      <p className="text-[14px] font-medium leading-snug">This week</p>
      <ul className="mt-2 grid gap-1.5">
        {plan.map((p) => (
          <li key={p.idea} className="flex items-center justify-between gap-2 rounded-xl bg-background/70 px-3 py-2 text-[13px] hairline">
            <span className="font-medium">{p.idea}</span>
            <span className={p.status === "Accepted" ? "font-semibold text-lime-ink" : "text-muted-foreground"}>{p.status}</span>
          </li>
        ))}
      </ul>
    </Example>
  );
}

const VIZ: Record<GrowthBlock["id"], () => React.ReactNode> = {
  intelligence: IntelligenceViz,
  memory: MemoryViz,
  adapt: AdaptViz,
  planner: PlannerViz,
};

function Block({ b }: { b: GrowthBlock }) {
  const Viz = VIZ[b.id];
  return (
    <li className="flex">
      <article data-flick="" data-spot="" aria-labelledby={`ge-${b.id}`} className="flex w-full flex-col rounded-[1.75rem] border border-border p-6 sm:p-7">
        <div className="flex items-center gap-3">
          <Icon3D name={b.icon} size={80} className="pop-in flick h-12 w-12 shrink-0" />
          <p className="text-[13px] font-semibold tracking-tight text-lime-ink">{b.name}</p>
        </div>
        <h3 id={`ge-${b.id}`} className="mt-5 text-[17px] font-semibold tracking-tight">{b.title}</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{b.body}</p>
        <ul className="mt-4 grid gap-2 text-[14px]">
          {b.bullets.map((x) => (
            <li key={x.label} className="flex items-start gap-2.5">
              <span aria-hidden="true" className="mt-[0.45em] h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />
              <span>
                {x.label}
                {x.note && <span className="text-muted-foreground"> ({x.note})</span>}
                {x.soon && <span className="lt-soon ml-2 whitespace-nowrap">Coming soon</span>}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-auto">
          <Viz />
        </div>
      </article>
    </li>
  );
}

/** R1261: the Content Growth Engine. The loop first, then one block per part of it, all live unless tagged. */
export function GrowthEngine() {
  return (
    <section id="growth" className="scroll-mt-24 py-16 sm:py-20" aria-labelledby="growth-title">
      <Shell>
        <SectionHead id="growth-title" eyebrow={GROWTH.eyebrow} title={GROWTH.title} body={GROWTH.body} />

        {/* The lime connectors draw in once the loop is revealed (CSS keyed off data-shown, globals.css R1261). */}
        <Reveal className="ge-loop mt-10 sm:mt-12">
          <ol className="ge-steps grid gap-3 sm:grid-cols-4 sm:gap-4" aria-label="The growth loop">
            {GROWTH.loop.map((s, i) => (
              <li key={s.label} className="ge-step relative flex items-start gap-3 sm:flex-col sm:items-center sm:text-center" style={{ ["--i" as string]: i }}>
                {i < GROWTH.loop.length - 1 && <span aria-hidden="true" className="ge-seg" />}
                <span aria-hidden="true" className="ge-node" />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold uppercase tracking-[0.14em]">{s.label}</span>
                  <span className="mt-1 block text-[14px] leading-snug text-muted-foreground">{s.hint}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-5 flex items-start gap-2 text-[14px] leading-relaxed text-muted-foreground sm:justify-center sm:text-center">
            <RotateCcw aria-hidden="true" className="mt-[0.2em] h-4 w-4 shrink-0 text-lime-ink" />
            {GROWTH.loopNote}
          </p>
        </Reveal>

        <Reveal as="ul" stagger className="mt-10 grid gap-4 md:grid-cols-2 sm:mt-12">
          {GROWTH_BLOCKS.map((b) => (
            <Block key={b.id} b={b} />
          ))}
        </Reveal>
      </Shell>
    </section>
  );
}
