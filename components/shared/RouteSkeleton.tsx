"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type SkeletonShape = "overview" | "grid" | "calendar" | "list" | "settings" | "analytics" | "platform" | "cards";

const Bar = ({ className, style }: { className?: string; style?: React.CSSProperties }) => <div className={cn("skeleton rounded-lg", className)} style={style} />;
const Panel = ({ className, children }: { className?: string; children?: React.ReactNode }) => <div className={cn("rounded-[24px] bg-foreground/[0.025] p-5 hairline", className)}>{children}</div>;

/** One stat card's worth of bars. */
const Stat = () => (
  <Panel>
    <Bar className="h-3 w-20" />
    <Bar className="mt-3 h-7 w-24" />
  </Panel>
);
const Rows = ({ n = 5, h = "h-11" }: { n?: number; h?: string }) => (
  <div className="space-y-3">
    {Array.from({ length: n }, (_, i) => (
      <Bar key={i} className={cn(h, "rounded-xl")} style={{ opacity: 1 - i * 0.12 }} />
    ))}
  </div>
);
const Head = ({ wide = false }: { wide?: boolean }) => (
  <div className="space-y-3">
    <Bar className="h-3 w-24" />
    <Bar className={cn("h-10 max-w-[80%] rounded-xl", wide ? "w-[34rem]" : "w-80")} />
    <Bar className="h-4 w-[26rem] max-w-[90%]" />
  </div>
);

/** The page outline each studio route draws while its data loads (block for block, roughly where it lands). */
function Shape({ shape }: { shape: SkeletonShape }) {
  switch (shape) {
    case "overview":
      return (
        <>
          <Head wide />
          <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Stat key={i} />)}</div>
          <div className="mt-3 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
            <Panel className="h-72" />
            <Panel className="h-72" />
          </div>
        </>
      );
    case "analytics":
      return (
        <>
          <div className="mt-10 flex flex-wrap items-end justify-between gap-6">
            <div className="w-full max-w-4xl space-y-3">
              <Bar className="h-4 w-44" />
              <Bar className="h-14 w-[90%] rounded-2xl" />
              <Bar className="h-14 w-[60%] rounded-2xl" />
            </div>
            <Bar className="h-[52px] w-72 rounded-full" />
          </div>
          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Stat key={i} />)}</div>
          <div className="mt-3 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
            <Panel className="h-[380px]" />
            <Panel className="h-[380px]" />
          </div>
        </>
      );
    case "platform":
      return (
        <>
          <div className="mt-8 flex items-center gap-4">
            <div className="skeleton h-16 w-16 shrink-0 rounded-full" />
            <div className="w-full space-y-2.5">
              <Bar className="h-3 w-32" />
              <Bar className="h-10 w-72 max-w-[80%] rounded-xl" />
            </div>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Stat key={i} />)}</div>
          <Panel className="mt-3 h-80" />
        </>
      );
    case "grid":
      return (
        <>
          <Head />
          <div className="mt-8 flex flex-wrap gap-2">{[0, 1, 2, 3].map((i) => <Bar key={i} className="h-11 w-24 rounded-full" />)}</div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <Panel key={i} className="h-60" />)}</div>
        </>
      );
    case "calendar":
      return (
        <>
          <Head />
          <div className="mt-8 flex items-center justify-between gap-3">
            <Bar className="h-11 w-48 rounded-full" />
            <Bar className="h-11 w-40 rounded-full" />
          </div>
          <Panel className="mt-5 p-3 sm:p-4">
            <div className="grid grid-cols-7 gap-2">{Array.from({ length: 35 }, (_, i) => <Bar key={i} className="h-20 rounded-xl sm:h-24" style={{ opacity: 0.55 + ((i * 7) % 5) * 0.09 }} />)}</div>
          </Panel>
        </>
      );
    case "list":
      return (
        <>
          <Head />
          <div className="mt-8 flex flex-wrap gap-2">{[0, 1, 2].map((i) => <Bar key={i} className="h-11 w-28 rounded-full" />)}</div>
          <Panel className="mt-5">
            <Rows n={6} h="h-16" />
          </Panel>
        </>
      );
    case "settings":
      return (
        <>
          <Head wide />
          <div className="mt-8 grid max-w-6xl gap-6 lg:mt-10 lg:grid-cols-[14.5rem_minmax(0,1fr)] lg:gap-10">
            <div className="hidden space-y-1.5 lg:block">{[0, 1, 2, 3, 4, 5].map((i) => <Bar key={i} className="h-11 rounded-xl" />)}</div>
            <Bar className="h-12 rounded-2xl lg:hidden" />
            <div className="space-y-3">
              <Bar className="h-7 w-40" />
              <Panel className="h-44" />
              <Panel className="h-56" />
            </div>
          </div>
        </>
      );
    default:
      return (
        <>
          <Head />
          <div className="mt-8 grid gap-3 md:grid-cols-3">{[0, 1, 2].map((i) => <Panel key={i} className="h-40" />)}</div>
          <Panel className="mt-3">
            <Rows n={4} />
          </Panel>
        </>
      );
  }
}

/**
 * Route loader for the studio (1065; replaces the full-screen hopping mascot, which made every click read as
 * "page, loader, page"). The outline of the page appears in place, after a 120ms beat so a fast route
 * swaps straight in without a flash, and the route stage settles the real blocks over it when they arrive.
 * Only a slow load (over 1.2 s) adds the old cheerful line, in a small pill at the top.
 */
export function RouteSkeleton({ shape, label, lines = [], frame = "px-5 pb-16 pt-8 sm:px-10 lg:pt-14" }: { shape: SkeletonShape; label: string; lines?: string[]; frame?: string }) {
  const [slow, setSlow] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 1200);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!slow || lines.length < 2) return;
    const t = setInterval(() => setN((v) => v + 1), 1800);
    return () => clearInterval(t);
  }, [slow, lines.length]);
  const line = lines.length ? lines[n % lines.length] : null;
  return (
    <div data-route-skeleton="" role="status" aria-busy="true" className={cn("route-skel relative", frame)}>
      <span className="sr-only">{label}</span>
      {slow && (
        <p className="route-slow absolute left-1/2 top-3 z-10 flex h-8 -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-background/90 px-3.5 text-[12.5px] font-medium text-muted-foreground shadow-sm hairline" aria-hidden="true">
          <span className="live-dot" />
          {label}
          {line && <span key={line} className="fl-line hidden text-foreground/80 sm:inline">· {line}</span>}
        </p>
      )}
      <div aria-hidden="true">
        <Shape shape={shape} />
      </div>
    </div>
  );
}
