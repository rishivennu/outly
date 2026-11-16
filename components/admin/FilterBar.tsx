"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { FilterChips } from "./SearchBox";

/**
 * 1163: the row of controls above a report. Filters on the left, and on the right the facts a reader needs to
 * trust the numbers: which source, which range, which timezone, when it was last computed. Every page that
 * filters uses this, so the controls sit in the same place on every screen.
 */
export function AdminFilterBar({ children, meta, label = "Filters", className }: { children?: React.ReactNode; meta?: React.ReactNode; label?: string; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cn("mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
      {meta && <p className="text-[12.5px] text-muted-foreground">{meta}</p>}
    </div>
  );
}

/** What a report should print beside its filters. Timezone is always named; "UTC days" is how every series is bucketed. */
export function ReportMeta({ source, range, tz = "UTC", updatedAt }: { source?: string; range: string; tz?: string; updatedAt?: Date | string | null }) {
  const at = updatedAt ? new Date(updatedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : null;
  return (
    <>
      {source && <>{source} · </>}
      {range} · {tz} days{at ? <> · updated {at} IST</> : null}
    </>
  );
}

export const RANGE_OPTIONS = [7, 30, 90] as const;

/**
 * The preset range chips (7/30/90 days) as a URL parameter, plus, when the page supports it, a custom from/to
 * pair. Custom dates are inclusive UTC days and clear the preset; choosing a preset clears the custom dates.
 */
export function AdminDateRangePicker({ param = "days", current, options = RANGE_OPTIONS, custom = false, from, to, label = "Range" }: { param?: string; current: number; options?: readonly number[]; custom?: boolean; from?: string | null; to?: string | null; label?: string }) {
  const sp = useSearchParams();
  const path = usePathname();
  const router = useRouter();
  const [a, setA] = useState(from ?? "");
  const [b, setB] = useState(to ?? "");
  const customOn = !!(from && to);
  const apply = () => {
    if (!a || !b || a > b) return;
    const n = new URLSearchParams(sp.toString());
    n.set("from", a);
    n.set("to", b);
    n.delete(param);
    n.delete("page");
    router.push(`${path}?${n}`, { scroll: false });
  };
  const clear = () => {
    const n = new URLSearchParams(sp.toString());
    n.delete("from");
    n.delete("to");
    router.push(`${path}?${n}`, { scroll: false });
  };
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      <FilterChips param={param} current={customOn ? "" : String(current)} options={options.map((d) => ({ value: String(d), label: `${d} days` }))} label={label} />
      {custom && (
        <form
          className="flex flex-wrap items-center gap-1.5 text-[12.5px]"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <label className="sr-only" htmlFor={`${param}-from`}>From</label>
          <input id={`${param}-from`} type="date" value={a} max={b || undefined} onChange={(e) => setA(e.target.value)} className="h-9 rounded-full bg-secondary/60 px-3 hairline" />
          <span aria-hidden className="text-muted-foreground">to</span>
          <label className="sr-only" htmlFor={`${param}-to`}>To</label>
          <input id={`${param}-to`} type="date" value={b} min={a || undefined} onChange={(e) => setB(e.target.value)} className="h-9 rounded-full bg-secondary/60 px-3 hairline" />
          <button type="submit" disabled={!a || !b || a > b} className="h-9 rounded-full bg-foreground px-3.5 font-semibold text-background disabled:opacity-40">Apply</button>
          {customOn && (
            <button type="button" onClick={clear} className="h-9 rounded-full px-3 font-medium text-muted-foreground [@media(hover:hover)]:hover:text-foreground">Clear</button>
          )}
        </form>
      )}
    </div>
  );
}
