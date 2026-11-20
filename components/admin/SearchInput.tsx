"use client";
import { useId, useRef } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * R1270: the admin search field, on the shared Input: search icon left, a clear button right (or the spinner
 * while the list reloads), Escape clears. 44px on touch screens. SearchBox wraps it for URL-driven search.
 */
export function SearchInput({ value, onChange, placeholder, busy = false, className, id }: { value: string; onChange: (v: string) => void; placeholder: string; busy?: boolean; className?: string; id?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  const ref = useRef<HTMLInputElement>(null);
  const clear = () => {
    onChange("");
    ref.current?.focus();
  };
  return (
    <div className={cn("relative block w-full sm:w-72", className)}>
      <label htmlFor={fid} className="sr-only">{placeholder}</label>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        ref={ref}
        id={fid}
        type="search"
        aria-busy={busy || undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          }
        }}
        placeholder={placeholder}
        className="h-11 rounded-full pl-10 pr-11 text-[14px] sm:h-10 touch:h-11 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {busy ? (
        <Loader2 className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
      ) : value ? (
        <button type="button" onClick={clear} aria-label="Clear search" className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--ring))] touch:h-11 touch:w-11 [@media(hover:hover)]:hover:bg-secondary [@media(hover:hover)]:hover:text-foreground">
          <X className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
