"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Search } from "lucide-react";

/** URL-driven search: debounced, keeps other filters, works with back/forward. */
export function SearchBox({ placeholder, param = "q" }: { placeholder: string; param?: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [v, setV] = useState(sp.get(param) ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get(param) ?? "") === v) return;
      const n = new URLSearchParams(sp.toString());
      v ? n.set(param, v) : n.delete(param);
      n.delete("page");
      router.replace(`${path}?${n}`, { scroll: false });
    }, 280);
    return () => clearTimeout(t);
  }, [v, sp, param, path, router]);
  return (
    <label className="relative block w-full sm:w-72">
      <span className="sr-only">{placeholder}</span>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input type="search" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className="h-10 w-full rounded-full bg-secondary/60 pl-10 pr-4 text-[14px] hairline placeholder:text-muted-foreground/80 focus:bg-secondary" />
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
