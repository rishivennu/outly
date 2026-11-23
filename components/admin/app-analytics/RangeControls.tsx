"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { RANGE_PRESETS, type Granularity, type Range } from "@/lib/analytics/activity-core";

/**
 * R1308: the date range for the whole App Analytics page, in the URL (so it survives refresh, back and sharing).
 * Presets (r=) clear a custom pair; a custom from/to (inclusive UTC days) clears the preset. "Compare with" adds a
 * second pair (cf/ct) that the Overview shows side by side. Granularity (g=) picks day / week / month buckets.
 *
 * Layout (R1308 follow-up): one toolbar, three auto-layout rows that share a 36 px control height (44 px on touch),
 * a 6 px gap inside a group and a 12 px gap between groups. Row 1 = presets (natural widths, wrap) with the
 * `trailing` slot (platform select) pushed to the right edge; row 2 = custom range + Apply on the left, bucket
 * segment on the right; row 3 = the comparison pair, Compare and Stop comparing as a single wrapping row. Nothing
 * has a fixed width: on phones every row simply wraps, date inputs stretch to share the line.
 */
export function RangeControls({ range, g, compare, trailing, meta }: { range: Range; g: Granularity; compare: { from: string; to: string } | null; /** Right-aligned extra filter on the presets row (platform). */ trailing?: React.ReactNode; /** Source / timezone / updated line under the toolbar. */ meta?: React.ReactNode }) {
  const sp = useSearchParams();
  const path = usePathname();
  const router = useRouter();
  const [a, setA] = useState(range.key === "custom" ? range.from : "");
  const [b, setB] = useState(range.key === "custom" ? range.to : "");
  const [cmp, setCmp] = useState(!!compare);
  const [ca, setCa] = useState(compare?.from ?? "");
  const [cb, setCb] = useState(compare?.to ?? "");

  const withParams = (edit: (n: URLSearchParams) => void) => {
    const n = new URLSearchParams(sp.toString());
    edit(n);
    n.delete("page");
    return `${path}?${n}`;
  };
  const presetHref = (key: string) => withParams((n) => { n.set("r", key); n.delete("from"); n.delete("to"); });
  const gHref = (key: Granularity) => withParams((n) => n.set("g", key));
  const apply = () => {
    if (!a || !b || a > b) return;
    router.push(withParams((n) => { n.set("from", a); n.set("to", b); n.delete("r"); }), { scroll: false });
  };
  const applyCompare = () => {
    if (!ca || !cb || ca > cb) return;
    router.push(withParams((n) => { n.set("cf", ca); n.set("ct", cb); }), { scroll: false });
  };
  const clearCompare = () => {
    setCmp(false);
    setCa("");
    setCb("");
    router.push(withParams((n) => { n.delete("cf"); n.delete("ct"); }), { scroll: false });
  };

  // One control height everywhere: chips, inputs, buttons and the trailing select all read as the same row.
  const chip = (on: boolean) => cn("inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))] touch:h-11", on ? "lime-bg font-semibold" : "bg-secondary/60 font-medium text-muted-foreground [@media(hover:hover)]:hover:text-foreground");
  const input = "h-9 min-w-0 flex-1 basis-[8.5rem] rounded-full px-3 text-[12.5px] tabular-nums sm:flex-none sm:w-[9.25rem] touch:h-11";
  const sep = <span aria-hidden className="shrink-0 text-[12.5px] text-muted-foreground">to</span>;

  return (
    <div className="flex flex-col gap-3" role="group" aria-label="Date range">
      {/* Row 1: presets, platform at the right edge */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" role="group" aria-label="Range presets">
          {RANGE_PRESETS.map((p) => (
            <Link key={p.key} href={presetHref(p.key)} scroll={false} data-on={range.key === p.key ? "true" : "false"} aria-current={range.key === p.key ? "true" : undefined} className={chip(range.key === p.key)}>
              {p.label}
            </Link>
          ))}
        </div>
        {trailing && <div className="flex w-full shrink-0 items-center sm:ml-auto sm:w-auto sm:self-start">{trailing}</div>}
      </div>

      {/* Row 2: custom range left, bucket right */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <form className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:flex-none" onSubmit={(e) => { e.preventDefault(); apply(); }} aria-label="Custom range">
          <label className="sr-only" htmlFor="aa-from">From</label>
          <Input id="aa-from" type="date" value={a} max={b || undefined} onChange={(e) => setA(e.target.value)} className={input} />
          {sep}
          <label className="sr-only" htmlFor="aa-to">To</label>
          <Input id="aa-to" type="date" value={b} min={a || undefined} onChange={(e) => setB(e.target.value)} className={input} />
          <Button type="submit" variant="lime" size="sm" className="shrink-0" disabled={!a || !b || a > b}>Apply</Button>
        </form>
        <div className="flex shrink-0 items-center gap-1.5 sm:ml-auto" role="group" aria-label="Bucket">
          {(["day", "week", "month"] as Granularity[]).map((k) => (
            <Link key={k} href={gHref(k)} scroll={false} aria-current={g === k ? "true" : undefined} className={chip(g === k)}>
              {k === "day" ? "Daily" : k === "week" ? "Weekly" : "Monthly"}
            </Link>
          ))}
        </div>
      </div>

      {/* Row 3: comparison, one wrapping row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/50 pt-3">
        {!cmp ? (
          <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={() => setCmp(true)}>Compare with another range</Button>
        ) : (
          <form className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); applyCompare(); }} aria-label="Compare with">
            <span className="w-full shrink-0 text-[12.5px] font-medium text-muted-foreground sm:w-auto sm:pr-1.5">Compare with</span>
            <label className="sr-only" htmlFor="aa-cf">Compare from</label>
            <Input id="aa-cf" type="date" value={ca} max={cb || undefined} onChange={(e) => setCa(e.target.value)} className={input} />
            {sep}
            <label className="sr-only" htmlFor="aa-ct">Compare to</label>
            <Input id="aa-ct" type="date" value={cb} min={ca || undefined} onChange={(e) => setCb(e.target.value)} className={input} />
            <div className="flex shrink-0 items-center gap-1.5">
              <Button type="submit" variant="lime" size="sm" disabled={!ca || !cb || ca > cb}>Compare</Button>
              <Button type="button" variant="ghost" size="sm" onClick={clearCompare}>{compare ? "Stop comparing" : "Cancel"}</Button>
            </div>
          </form>
        )}
      </div>

      {meta && <p className="text-[12px] text-muted-foreground">{meta}</p>}
    </div>
  );
}
