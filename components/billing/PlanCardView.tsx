import { Check } from "lucide-react";
import { DotText } from "@/components/brand/DotText";
import type { CardStyle } from "@/lib/billing/display";
import { cn } from "@/lib/utils";

/** Lines shown on a card before the rest fold under "+N more" (1038), so every card stays about the same height. */
export const CARD_FEATURES = 5;

/**
 * One pricing card, shared by the landing page and the admin live preview, so what the admin sees is
 * exactly what goes live. `variant` is the card style picked in Admin > Pricing:
 * live (Live Activity: dot-letter name, glowing price box), classic (the previous outline cards),
 * glass (frosted, lime glow behind the popular plan) and bold (the popular plan is a solid lime card).
 */
export function PlanCardView({
  name,
  note,
  price,
  priceMinor,
  interval,
  state,
  features,
  featured,
  cta,
  save = 0,
  variant = "live",
  className,
}: {
  name: string;
  note?: string | null;
  /** The formatted price, or a node (the admin and the cycle switch animate it). */
  price: React.ReactNode;
  priceMinor: number;
  interval: string;
  state: string;
  features: string[];
  /** The highlighted plan (or every live plan during the free beta). */
  featured?: boolean;
  cta: React.ReactNode;
  /** Percent saved by paying yearly; shown next to "Billed yearly". */
  save?: number;
  variant?: CardStyle;
  className?: string;
}) {
  const live = state === "available";
  const hot = !!featured && live;
  const billing = !live ? "Not on sale yet" : priceMinor === 0 ? "Free plan" : interval === "year" ? (save > 0 ? `Billed yearly, save ${save}%` : "Billed yearly") : "Billed monthly";
  const v = variant;
  const la = v === "live";

  const root = {
    live: cn("la-card la-themed pc-live overflow-hidden p-5 sm:p-6", live && "la-live", hot && "pc-hot ring-2 ring-lime ring-offset-2 ring-offset-background"),
    classic: cn("pc-classic p-7 sm:p-8", hot ? "border-2 border-lime bg-lime/[0.07]" : "border border-border"),
    glass: cn("pc-glass overflow-hidden p-6 sm:p-7", hot && "pc-hot"),
    bold: cn("pc-bold overflow-hidden p-6 sm:p-7", hot && "pc-hot"),
  }[v];
  const mute = la ? "la-mute" : hot && v === "bold" ? "pc-bold-mute" : "text-muted-foreground";
  const accent = la ? "la-accent" : hot && v === "bold" ? "" : "pc-accent";

  const pill = hot && name && v !== "classic" ? (
    <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em]", v === "bold" ? "bg-[#0b0b0d] text-white" : "bg-lime text-[hsl(var(--lime-foreground))]")}>Popular</span>
  ) : !live ? (
    <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]", la ? "la-box la-mute" : "border border-border text-muted-foreground")}>Soon</span>
  ) : null;

  const title = la ? (
    <h3 className="min-w-0">
      <span className="sr-only">{name || "Plan name"}</span>
      <DotText text={name || "PLAN"} className="h-8 max-w-full sm:h-9" />
    </h3>
  ) : (
    <h3 className={cn("min-w-0 tracking-tight", v === "bold" ? "text-[13px] font-bold uppercase tracking-[0.14em]" : "text-xl font-semibold")}>{name || "Plan name"}</h3>
  );

  const priceEl =
    v === "live" ? (
      <div className="la-box pc-price relative mt-4 rounded-[1.25rem] px-4 py-3">
        <p className={cn("text-[1.9rem] font-semibold leading-none tracking-tightest tabular", live ? "la-accent" : "la-mute")}>{price}</p>
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.1em] la-mute">{billing}</p>
      </div>
    ) : v === "classic" ? (
      <div className="mt-5">
        <p className={cn("text-[1.6rem] font-semibold tracking-tightest tabular", live ? "text-lime-ink" : "text-muted-foreground")}>{price}</p>
        {live && interval === "year" && priceMinor > 0 && <p className="mt-0.5 text-[12.5px] font-medium text-muted-foreground">{billing}</p>}
      </div>
    ) : (
      <div className={cn("relative", v === "bold" ? "mt-7" : "mt-6")}>
        <p className={cn("font-display font-semibold leading-none tracking-tightest tabular", v === "bold" ? "text-[2.75rem]" : "text-[2.25rem]", !live && "text-muted-foreground")}>{price}</p>
        <p className={cn("mt-2.5 text-[12px] font-semibold uppercase tracking-[0.1em]", mute)}>{billing}</p>
      </div>
    );

  const line = (b: string, i: number) => (
    <li key={`${i}-${b}`} className="flex items-start gap-2.5 text-[14.5px] leading-snug">
      {v === "glass" ? (
        <span className={cn("pcg-check mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full", !live && "opacity-60")} aria-hidden="true">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      ) : (
        <Check className={cn("mt-0.5 h-4 w-4 shrink-0", live ? (la ? "la-accent" : v === "classic" ? "text-lime-ink" : accent) : mute)} aria-hidden="true" />
      )}
      <span className={live ? undefined : mute}>{b}</span>
    </li>
  );

  return (
    <article className={cn("relative flex h-full flex-col rounded-[1.75rem]", root, className)}>
      {la && <span className="la-grid rounded-[inherit]" aria-hidden="true" />}
      <div className="relative flex items-start justify-between gap-3">
        {title}
        {pill}
      </div>
      {v === "classic" ? (
        <>
          {priceEl}
          <p className="mt-1 text-sm text-muted-foreground">{note}</p>
        </>
      ) : (
        <>
          <p className={cn("relative mt-2 text-sm", mute)}>{note || "\u00a0"}</p>
          {priceEl}
        </>
      )}

      <div className={cn("relative flex-1", v === "classic" ? "mt-6" : "mt-5", v === "bold" && "border-t pt-5", v === "bold" && (hot ? "border-black/15" : "border-border"))}>
        <ul className="flex flex-col gap-2.5">{features.slice(0, CARD_FEATURES).map(line)}</ul>
        {features.length > CARD_FEATURES && (
          <details className="group mt-2.5">
            <summary className={cn("inline-flex min-h-[44px] cursor-pointer list-none items-center rounded-full text-[13.5px] font-semibold underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden", la ? "la-accent" : accent || undefined)}>
              <span className="group-open:hidden">+{features.length - CARD_FEATURES} more</span>
              <span className="hidden group-open:inline">Show less</span>
            </summary>
            <ul className="mt-1 flex flex-col gap-2.5">{features.slice(CARD_FEATURES).map((b, i) => line(b, i + CARD_FEATURES))}</ul>
          </details>
        )}
      </div>

      <div className={cn("relative flex flex-col", v === "classic" ? "mt-7" : "mt-6")}>{cta}</div>
    </article>
  );
}
