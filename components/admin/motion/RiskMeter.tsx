"use client";
import { useSeen } from "@/components/dashboard/motion";
import { RollingNumber } from "@/components/dashboard/RollingNumber";

/**
 * Everyone on one bar, split by risk (1081): high, worth a look, doing fine. The segments fill in left to
 * right the first time the bar is seen. The bar is an image with a full text label; the legend repeats
 * the counts as text for everyone else.
 */
export function RiskMeter({ high, medium, low }: { high: number; medium: number; low: number }) {
  const { ref, seen } = useSeen<HTMLDivElement>(0.3);
  const total = high + medium + low;
  const part = (n: number) => (total ? (n / total) * 100 : 0);
  const segs = [
    { key: "high", label: "High risk", n: high, cls: "bg-destructive" },
    { key: "medium", label: "Worth a look", n: medium, cls: "bg-warning" },
    { key: "low", label: "Doing fine", n: low, cls: "bg-success" },
  ];
  const share = (n: number) => `${Math.round(part(n))}%`;
  return (
    <div>
      <div
        ref={ref}
        role="img"
        aria-label={total ? `${total.toLocaleString("en-IN")} creators: ${segs.map((s) => `${s.label.toLowerCase()} ${s.n.toLocaleString("en-IN")} (${share(s.n)})`).join(", ")}.` : "No creators scored yet."}
        className="relative h-3 overflow-hidden rounded-full bg-secondary/70"
      >
        {total > 0 && (
          <span
            className="grow-clip absolute inset-0 flex rounded-full"
            style={{ "--cut": seen ? "0%" : "100%" } as React.CSSProperties}
          >
            {segs.map((s) => {
              const w = part(s.n);
              return w > 0 ? <span key={s.key} className={`${s.cls} h-full`} style={{ width: `${w}%` }} /> : null;
            })}
          </span>
        )}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px]">
        {segs.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${s.cls}`} aria-hidden />
            <span className="text-muted-foreground">{s.label}</span>
            <RollingNumber value={s.n.toLocaleString("en-IN")} className="font-semibold tabular" />
            <span className="text-muted-foreground tabular">{share(s.n)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
