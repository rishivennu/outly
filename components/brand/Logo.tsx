import { useId } from "react";
import { cn } from "@/lib/utils";

/** Outly mark: a lime "O" with a play notch, sending a spark out to the top-right. */
export function OutlyMark({ size = 28, className }: { size?: number; className?: string }) {
  // per-instance gradient id: a shared id breaks when the owning instance is display:none
  const id = `outly-g-${useId().replace(/:/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="hsl(78 100% 62%)" />
          <stop offset="1" stopColor="hsl(84 100% 44%)" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="#0d0d10" />
      <circle cx="15" cy="17" r="8.2" fill="none" stroke={`url(#${id})`} strokeWidth="4.2" />
      <path d="M13.2 13.6v6.8l5.6-3.4z" fill={`url(#${id})`} />
      <path d="M22.5 5.5h4v4" fill="none" stroke="hsl(330 90% 66%)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M26.5 5.5 21 11" stroke="hsl(330 90% 66%)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function OutlyLogo({ size = 28, className, label = true }: { size?: number; className?: string; label?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <OutlyMark size={size} />
      {label && <span className="font-display text-[1.15em] font-bold tracking-[-0.045em]">outly</span>}
    </span>
  );
}
