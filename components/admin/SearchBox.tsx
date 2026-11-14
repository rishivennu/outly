"use client";
import { useEffect, useId, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronDown, Loader2, Search, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollX } from "@/components/ui/scroll-x";
import { useSlider } from "@/components/dashboard/useSlider";

/** URL-driven search: debounced, keeps other filters, works with back/forward. */
export function SearchBox({ placeholder, param = "q" }: { placeholder: string; param?: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [v, setV] = useState(sp.get(param) ?? "");
  // The list re-renders on the server; a transition keeps typing smooth and lets us show it is working.
  const [pending, start] = useTransition();
  // Back/forward changed the URL under us: show that query instead of pushing the old text back.
  const urlQ = sp.get(param) ?? "";
  const [seen, setSeen] = useState(urlQ);
  if (urlQ !== seen) {
    setSeen(urlQ);
    setV(urlQ);
  }
  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get(param) ?? "") === v) return;
      const n = new URLSearchParams(sp.toString());
      v ? n.set(param, v) : n.delete(param);
      n.delete("page");
      start(() => router.replace(`${path}?${n}`, { scroll: false }));
    }, 220);
    return () => clearTimeout(t);
  }, [v, sp, param, path, router]);
  return (
    <label className="relative block w-full sm:w-72">
      <span className="sr-only">{placeholder}</span>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input type="search" aria-busy={pending} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className="h-11 w-full rounded-full bg-secondary/60 pl-10 pr-10 sm:h-10 text-[14px] hairline placeholder:text-muted-foreground/80 focus:bg-secondary" />
      {pending && <Loader2 className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
    </label>
  );
}

export function FilterChips({ param, options, current, glide = false, label = "Filter" }: { param: string; options: { value: string; label: string }[]; current: string; glide?: boolean; label?: string }) {
  const sp = useSearchParams();
  const path = usePathname();
  const href = (v: string) => {
    const n = new URLSearchParams(sp.toString());
    v ? n.set(param, v) : n.delete(param);
    n.delete("page");
    return `${path}?${n}`;
  };
  if (glide) return <GlideChips options={options} current={current} href={href} />;
  // Phones: one segmented row that scrolls sideways inside the card (edge fade shows there is more), never a
  // stack of wrapped rows. From 640px up the chips wrap as before. 44px tall on touch screens, 36px with a mouse.
  return (
    <ScrollX label={label} focusable={false} className="-mx-5 w-[calc(100%+2.5rem)] px-5 sm:mx-0 sm:w-auto sm:overflow-visible sm:px-0">
      <div className="flex w-max gap-1.5 py-0.5 sm:w-auto sm:flex-wrap" role="group" aria-label={label}>
        {options.map((o) => (
          <Link key={o.value} href={href(o.value)} scroll={false} aria-current={current === o.value ? "true" : undefined} className={cn("inline-flex h-11 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[12.5px] sm:h-9", current === o.value ? "lime-bg font-semibold" : "bg-secondary/60 font-medium text-muted-foreground hairline hover:text-foreground")}>
            {o.label}
          </Link>
        ))}
      </div>
    </ScrollX>
  );
}

/**
 * The analytics version of the chips (1081): one lime plate slides to the picked chip the moment it is
 * clicked (before the server answers), on a single track. Same links and URLs as the plain chips, so
 * back/forward, new tabs and screen readers behave the same. Reduced motion: the plate jumps.
 */
function GlideChips({ options, current, href }: { options: { value: string; label: string }[]; current: string; href: (v: string) => string }) {
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => setPending(null), [current]);
  const on = pending ?? current;
  const s = useSlider<HTMLDivElement>(on, { selector: '[data-on="true"]', block: true });
  return (
    <div ref={s.box} className="chip-track relative" role="group" aria-label="Filter">
      <span ref={s.bar} aria-hidden="true" className="chip-plate lime-bg" />
      {options.map((o) => (
        <Link
          key={o.value}
          href={href(o.value)}
          scroll={false}
          data-on={on === o.value ? "true" : undefined}
          aria-current={current === o.value ? "true" : undefined}
          onClick={(e) => { if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)) setPending(o.value); }}
          className={on === o.value ? "chip-glide is-on" : "chip-glide"}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

/**
 * One URL-driven drop-down filter (1039): picking a value replaces that search param, keeps the others
 * and goes back to page 1. A native <select>, so keyboard, screen readers and phones all just work.
 */
export function FilterSelect({ param, label, options, current, fill = false }: { param: string; label: string; options: { value: string; label: string }[]; current: string; /** Stretch to its grid cell on phones (the users filter grid). */ fill?: boolean }) {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [pending, start] = useTransition();
  const on = current !== "" && current !== options[0]?.value;
  return (
    <label className={cn("relative inline-flex min-w-0 flex-col gap-1", fill && "w-full sm:w-auto")}>
      <span className="text-[11.5px] font-medium text-muted-foreground">{label}</span>
      <select
        value={current}
        aria-busy={pending}
        onChange={(e) => {
          const n = new URLSearchParams(sp.toString());
          e.target.value ? n.set(param, e.target.value) : n.delete(param);
          n.delete("page");
          start(() => router.replace(`${path}?${n}`, { scroll: false }));
        }}
        className={cn(
          "h-11 rounded-full pl-3.5 pr-8 text-[13px]",
          fill ? "w-full min-w-0 sm:w-auto sm:min-w-[9.5rem]" : "min-w-[9.5rem]",
          on ? "bg-[hsl(var(--lime)/0.16)] font-semibold ring-1 ring-[hsl(var(--lime)/0.55)]" : "bg-secondary/60 font-medium hairline",
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {pending && <Loader2 className="pointer-events-none absolute bottom-3.5 right-3 h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
    </label>
  );
}

/**
 * The less-used filters (1142). On phones they fold behind a "More filters" button that says how many of them
 * are on, so the filter block stays two rows tall; from 640px up the button disappears and the filters sit
 * inline in the same row as the others (display: contents), exactly as before.
 */
/** A calendar-day filter (1142, waitlist joined from / to). Empty clears it; the value lives in the URL like the rest. */
export function DateFilter({ param, label, current, min, max }: { param: string; label: string; current: string; min?: string; max?: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [pending, start] = useTransition();
  return (
    <label className="relative inline-flex w-full min-w-0 flex-col gap-1 sm:w-auto">
      <span className="text-[11.5px] font-medium text-muted-foreground">{label}</span>
      <input
        type="date"
        value={current}
        min={min || undefined}
        max={max || undefined}
        aria-busy={pending}
        onChange={(e) => {
          const n = new URLSearchParams(sp.toString());
          e.target.value ? n.set(param, e.target.value) : n.delete(param);
          n.delete("page");
          start(() => router.replace(`${path}?${n}`, { scroll: false }));
        }}
        className={cn("h-11 w-full min-w-0 rounded-full px-3.5 text-[13px] sm:w-[10.5rem]", current ? "bg-[hsl(var(--lime)/0.16)] font-semibold ring-1 ring-[hsl(var(--lime)/0.55)]" : "bg-secondary/60 font-medium hairline")}
      />
    </label>
  );
}

export function MoreFilters({ active, children }: { active: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-medium hairline hover:bg-secondary sm:hidden",
          active > 0 && "font-semibold ring-1 ring-[hsl(var(--lime)/0.55)]",
        )}
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden />
        More filters
        {active > 0 && <span className="tabular rounded-full bg-[hsl(var(--lime)/0.2)] px-1.5 text-[11.5px] font-semibold">{active}<span className="sr-only"> on</span></span>}
        <ChevronDown className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      <div id={id} className={cn("col-span-2 grid-cols-2 gap-2.5 sm:contents", open ? "grid" : "hidden")}>
        {children}
      </div>
    </>
  );
}
