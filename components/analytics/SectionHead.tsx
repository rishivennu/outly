import { cn } from "@/lib/utils";

/** One heading pattern for every section on the Analytics page, so the order of importance reads the same
 * everywhere: kicker, a real h2, one line of what the section is for, and its actions on the right. */
export function SectionHead({ id, kicker, title, desc, live, children, className }: { id: string; kicker?: string; title: string; desc?: React.ReactNode; live?: boolean; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="min-w-0 max-w-2xl">
        {kicker && (
          <p className="ai-kicker flex items-center gap-2 text-sm font-semibold">
            {live && <span className="live-dot" aria-hidden="true" />}
            {kicker}
          </p>
        )}
        <h2 id={id} className="mt-1 text-[clamp(1.4rem,2.2vw,1.75rem)] font-semibold leading-tight tracking-tight">{title}</h2>
        {desc && <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{desc}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  );
}
