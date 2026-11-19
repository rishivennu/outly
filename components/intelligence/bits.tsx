"use client";
import { CircleAlert, CircleCheck, CircleDot } from "lucide-react";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { cn } from "@/lib/utils";
import { CONFIDENCE_WORD, formatLabel, isPlatformKey, platformLabel } from "./view-core";
import type { Confidence } from "./types";

// R1238: the small pieces every Content Intelligence section shares, so one card never invents its own look.
export function Card({ id, title, desc, children, className }: { id: string; title: string; desc?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn("glass rounded-[28px] p-5 sm:p-6", className)}>
      <div className="max-w-2xl">
        <h2 id={id} className="text-lg font-semibold tracking-tight">{title}</h2>
        {desc && <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">{desc}</p>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const CONF_STYLE: Record<Confidence, string> = {
  high: "bg-lime text-[hsl(var(--lime-foreground))]",
  medium: "bg-secondary text-foreground",
  low: "bg-warning/[0.14] text-warning-ink",
};
const CONF_ICON: Record<Confidence, typeof CircleCheck> = { high: CircleCheck, medium: CircleDot, low: CircleAlert };

/** The word first, the colour and the glyph only as a second signal. */
export function ConfidenceBadge({ level, n }: { level: Confidence; n?: number }) {
  const Icon = CONF_ICON[level];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold hairline", CONF_STYLE[level])}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {CONFIDENCE_WORD[level]}
      {n !== undefined && <span className="font-medium tabular">from {n.toLocaleString("en")}</span>}
    </span>
  );
}

export function Chips({ platform, format }: { platform: string; format: string }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/70 px-2.5 py-1 font-medium hairline">
        {isPlatformKey(platform) && <PlatformOrb platform={platform} size={14} />}
        {platformLabel(platform)}
      </span>
      <span className="rounded-full bg-secondary/70 px-2.5 py-1 font-medium hairline">{formatLabel(format)}</span>
    </span>
  );
}

/** A section that is specified but not built yet. Said plainly, never dressed up as data. */
export function LaterCard({ id, title, what }: { id: string; title: string; what: string }) {
  return (
    <Card id={id} title={title} desc={what}>
      <p className="rounded-2xl bg-secondary/50 p-4 text-sm text-muted-foreground hairline">Coming in a later round. Nothing is hidden here: this section has no numbers yet.</p>
    </Card>
  );
}
