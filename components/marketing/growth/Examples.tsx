import { ArrowRight, Bookmark, Check, CircleCheck, CircleSlash, Film, GalleryHorizontalEnd, Image as ImageIcon, Lightbulb, Type } from "lucide-react";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { cn } from "@/lib/utils";
import type { Platform } from "@/lib/domain";
import type { GrowthBlock } from "@/lib/marketing/content";

// R1263: small product-interface previews in the Intelligence page's vocabulary (components/intelligence/bits.tsx:
// confidence badge, platform and format chips, planner statuses), copied here so the landing page ships no studio
// code. Illustrative only: every one is labelled Example, carries no real numbers and is hidden from assistive tech
// (the card's own text says the same thing).
const ROW = "rounded-lg bg-card px-3 py-2.5 hairline";
const CHIP = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-secondary px-2.5 py-1 text-xs font-medium hairline";

function Example({ children }: { children: React.ReactNode }) {
  return (
    <div aria-hidden="true" className="ge-viz rounded-3xl bg-secondary/50 p-4 hairline">
      <p className="ge-ex-label mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Example</p>
      {children}
    </div>
  );
}

function IntelligenceExample() {
  const bars = [
    { label: "How-to Reels", word: "Above usual", fill: "w-[86%] bg-lime" },
    { label: "Your usual Reels", word: "Baseline", fill: "w-[52%] bg-muted-foreground/45" },
  ];
  return (
    <Example>
      <div className={ROW}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] font-semibold text-lime-ink">Best-performing</p>
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-lime px-2.5 py-1 text-xs font-semibold text-[hsl(var(--lime-foreground))] hairline">
            <CircleCheck className="h-3.5 w-3.5" />
            High confidence
          </span>
        </div>
        <p className="mt-2 text-[15px] font-semibold tracking-tight">How-to Reels</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className={CHIP}>
            <PlatformOrb platform="instagram" size={14} />
            Instagram
          </span>
          <span className={CHIP}>Video</span>
        </div>
        <ul className="mt-3.5 grid gap-2.5">
          {bars.map((b) => (
            <li key={b.label}>
              <div className="flex items-baseline justify-between gap-2 text-[12px]">
                <span className="min-w-0 text-muted-foreground">{b.label}</span>
                <span className="whitespace-nowrap font-medium">{b.word}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                <div className={cn("ge-bar h-full rounded-full", b.fill)} />
              </div>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-3 flex items-start gap-2 px-1 text-[13px] leading-snug">
        <ArrowRight className="mt-[0.15em] h-3.5 w-3.5 shrink-0 text-lime-ink" />
        <span className="min-w-0">Next: make another how-to Reel this week.</span>
      </p>
    </Example>
  );
}

function MemoryExample() {
  const versions: { platform: Platform; where: string; tracked: boolean; state: string }[] = [
    { platform: "instagram", where: "Instagram Reel", tracked: true, state: "Views tracked" },
    { platform: "youtube", where: "YouTube Short", tracked: true, state: "Views tracked" },
    { platform: "x", where: "X post", tracked: false, state: "Not provided by X" },
  ];
  return (
    <Example>
      <div className={cn(ROW, "flex items-center gap-2.5")}>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-secondary text-foreground">
          <Film className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold">Original upload</span>
          <span className="block text-[12px] text-muted-foreground">Your source video</span>
        </span>
      </div>
      <ul className="ge-tree ms-[1.625rem] ps-4">
        {versions.map((v, i) => (
          <li key={v.where} className="relative pt-1.5">
            <span className={cn("ge-branch absolute -start-4 top-0 w-px bg-border", i === versions.length - 1 ? "h-[calc(50%+0.1875rem)]" : "h-full")} />
            <span className="ge-branch absolute -start-4 top-[calc(50%+0.1875rem)] h-px w-3.5 bg-border" />
            <div className={cn(ROW, "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2")}>
              <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium">
                <PlatformOrb platform={v.platform} size={16} />
                {v.where}
              </span>
              <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-[12px]", v.tracked ? "font-medium text-foreground" : "text-muted-foreground")}>
                {v.tracked ? <Check className="h-3.5 w-3.5 text-lime-ink" /> : <CircleSlash className="h-3.5 w-3.5" />}
                {v.state}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Example>
  );
}

function AdaptExample() {
  const formats = [
    { icon: Film, label: "Video", where: "Every platform" },
    { icon: ImageIcon, label: "Image post", where: "Instagram" },
    { icon: GalleryHorizontalEnd, label: "Carousel", where: "Instagram" },
  ];
  return (
    <Example>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center">
        <div className={cn(ROW, "relative flex flex-col items-center gap-1 px-3 py-3 text-center")}>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-lime text-[hsl(var(--lime-foreground))]">
            <Lightbulb className="h-4 w-4" />
          </span>
          <span className="text-[12px] font-semibold leading-tight">One idea</span>
          <span className="ge-branch absolute -end-4 top-1/2 h-px w-4 bg-border" />
        </div>
        <ul className="ge-fan ms-4 ps-4">
          {[...formats, null].map((f, i) => {
            const Icon = f ? f.icon : Type;
            return (
              <li key={f ? f.label : "text"} className="relative py-[3px]">
                <span className={cn("ge-branch absolute -start-4 w-px bg-border", i === 0 ? "top-1/2 h-1/2" : i === formats.length ? "top-0 h-1/2" : "top-0 h-full")} />
                <span className="ge-branch absolute -start-4 top-1/2 h-px w-3.5 bg-border" />
                <div className={cn(ROW, "flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-[13px]")}>
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{f ? f.label : "Text post"}</span>
                  {f ? <span className="text-[12px] text-muted-foreground">{f.where}</span> : <span className="lt-soon whitespace-nowrap">Coming soon</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Example>
  );
}

function PlannerExample() {
  const plan = [
    { idea: "Quick tutorial", format: "Reel", status: "Accepted" },
    { idea: "Behind the scenes", format: "Short", status: "Saved" },
    { idea: "Weekly recap", format: "Carousel", status: "Open" },
  ] as const;
  const STATUS = {
    Accepted: { icon: Check, cls: "bg-lime font-semibold text-[hsl(var(--lime-foreground))]" },
    Saved: { icon: Bookmark, cls: "bg-secondary font-medium text-foreground" },
    Open: { icon: null, cls: "bg-card font-medium text-muted-foreground" },
  };
  return (
    <Example>
      <p className="mb-2 px-1 text-[13px] font-semibold">This week</p>
      <ul className="grid gap-1.5">
        {plan.map((p) => {
          const s = STATUS[p.status];
          const Icon = s.icon;
          return (
            <li key={p.idea} className={cn(ROW, "flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2")}>
              <span className="min-w-0 flex-1 basis-[8rem] text-[13px] font-medium">{p.idea}</span>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className={CHIP}>{p.format}</span>
                <span className={cn("ge-status inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs hairline", s.cls)}>
                  {Icon && <Icon className="h-3 w-3" />}
                  {p.status}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </Example>
  );
}

export const GROWTH_EXAMPLES: Record<GrowthBlock["id"], () => React.ReactNode> = {
  intelligence: IntelligenceExample,
  memory: MemoryExample,
  adapt: AdaptExample,
  planner: PlannerExample,
};
