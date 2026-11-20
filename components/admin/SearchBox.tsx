"use client";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronDown, Loader2, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/field";
import { SearchInput } from "./SearchInput";
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
  return <SearchInput value={v} onChange={setV} placeholder={placeholder} busy={pending} />;
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
  // Phones and tablets: one segmented control (the glass trough, .gseg, with the chosen chip as its brighter
  // pane) that scrolls sideways inside the card (edge fade shows there is more), never a stack of wrapped rows.
  // From 1024px up the .gseg rules are inert and the chips wrap as before. 44px tall on touch screens.
  // R1270: the chips stay links (aria-current), not tabs.
  return (
    <ScrollX label={label} focusable={false} className="-mx-5 w-[calc(100%+2.5rem)] px-5 sm:mx-0 sm:w-auto sm:px-0 lg:overflow-visible">
      <div className="gseg flex w-max gap-0.5 lg:w-auto lg:flex-wrap lg:gap-1.5 lg:py-0.5" role="group" aria-label={label}>
        {options.map((o) => (
          <Link key={o.value} href={href(o.value)} scroll={false} data-on={current === o.value ? "true" : "false"} aria-current={current === o.value ? "true" : undefined} className={cn("inline-flex h-11 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))] sm:h-9 touch:h-11", current === o.value ? "lime-bg font-semibold" : "bg-secondary/60 font-medium text-muted-foreground [@media(hover:hover)]:hover:text-foreground")}>
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
      <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
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
          "h-11 cursor-pointer appearance-none rounded-2xl pl-3.5 pr-9 text-[13px] text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))]",
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
      {pending ? (
        <Loader2 className="pointer-events-none absolute bottom-3.5 right-3 h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
      ) : (
        <ChevronDown className="pointer-events-none absolute bottom-3.5 right-3 h-4 w-4 text-muted-foreground" aria-hidden />
      )}
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
      <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
      <Input
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
        className={cn("h-11 w-full min-w-0 rounded-2xl px-3.5 text-[13px] sm:w-[10.5rem]", current && "bg-[hsl(var(--lime)/0.16)] font-semibold ring-1 ring-[hsl(var(--lime)/0.55)]")}
      />
    </label>
  );
}

export function MoreFilters({ active, children }: { active: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // R1270: Escape closes and hands focus back to the button; a tap outside the button and the panel closes.
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    const down = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (trigger.current?.contains(t) || panel.current?.contains(t))) return;
      setOpen(false);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", down);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", down);
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-11 items-center justify-center gap-2 rounded-full bg-secondary/60 px-4 text-[13px] font-medium [@media(hover:hover)]:hover:bg-secondary sm:hidden",
          active > 0 && "font-semibold ring-1 ring-[hsl(var(--lime)/0.55)]",
        )}
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden />
        More filters
        {active > 0 && <span className="tabular rounded-full bg-[hsl(var(--lime)/0.2)] px-1.5 text-[11.5px] font-semibold">{active}<span className="sr-only"> on</span></span>}
        <ChevronDown className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      <div ref={panel} id={id} className={cn("col-span-2 grid-cols-2 gap-2.5 sm:contents", open ? "grid" : "hidden")}>
        {children}
      </div>
    </>
  );
}
