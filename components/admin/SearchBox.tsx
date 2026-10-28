"use client";
import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, Search } from "lucide-react";

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
      <input type="search" aria-busy={pending} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className="h-10 w-full rounded-full bg-secondary/60 pl-10 pr-10 text-[14px] hairline placeholder:text-muted-foreground/80 focus:bg-secondary" />
      {pending && <Loader2 className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
    </label>
  );
}

export function FilterChips({ param, options, current }: { param: string; options: { value: string; label: string }[]; current: string }) {
  const sp = useSearchParams();
  const path = usePathname();
  const href = (v: string) => {
    const n = new URLSearchParams(sp.toString());
    v ? n.set(param, v) : n.delete(param);
    n.delete("page");
    return `${path}?${n}`;
  };
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter">
      {options.map((o) => (
        <Link key={o.value} href={href(o.value)} scroll={false} aria-current={current === o.value ? "true" : undefined} className={current === o.value ? "lime-bg h-9 rounded-full px-3.5 text-[12.5px] font-semibold leading-9" : "h-9 rounded-full bg-secondary/60 px-3.5 text-[12.5px] font-medium leading-9 text-muted-foreground hairline hover:text-foreground"}>
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
export function FilterSelect({ param, label, options, current }: { param: string; label: string; options: { value: string; label: string }[]; current: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [pending, start] = useTransition();
  const on = current !== "" && current !== options[0]?.value;
  return (
    <label className="relative inline-flex min-w-0 flex-col gap-1">
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
        className={
          on
            ? "h-11 min-w-[9.5rem] rounded-full bg-[hsl(var(--lime)/0.16)] pl-3.5 pr-8 text-[13px] font-semibold ring-1 ring-[hsl(var(--lime)/0.55)]"
            : "h-11 min-w-[9.5rem] rounded-full bg-secondary/60 pl-3.5 pr-8 text-[13px] font-medium hairline"
        }
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
