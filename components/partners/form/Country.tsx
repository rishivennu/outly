"use client";
import { useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { COUNTRIES } from "./countries";
import { CONTROL } from "./Field";

/** A type-to-filter country picker (WAI-ARIA combobox with a listbox popup). Picking from the list is required. */
export function CountryCombobox({
  id,
  value,
  onChange,
  onBlur,
  ...aria
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}) {
  const list = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q || COUNTRIES.some((c) => c.toLowerCase() === q)) return [...COUNTRIES];
    const starts = COUNTRIES.filter((c) => c.toLowerCase().startsWith(q));
    return [...starts, ...COUNTRIES.filter((c) => !starts.includes(c) && c.toLowerCase().includes(q))];
  }, [value]);

  const show = (i: number) => {
    setActive(i);
    box.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const pick = (c: string) => {
    onChange(c);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const n = matches.length;
      if (n) show((active + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "Enter" && open && matches[active]) {
      e.preventDefault();
      pick(matches[active]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        id={id}
        {...aria}
        role="combobox"
        aria-expanded={open}
        aria-controls={list}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${list}-${active}` : undefined}
        autoComplete="country-name"
        placeholder="Start typing your country"
        maxLength={60}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKey}
        onBlur={() => {
          setOpen(false);
          const exact = COUNTRIES.find((c) => c.toLowerCase() === value.trim().toLowerCase());
          if (exact && exact !== value) onChange(exact);
          onBlur();
        }}
        className={cn(CONTROL, "pe-11")}
      />
      <ChevronDown className="pointer-events-none absolute end-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <ul
        ref={box}
        id={list}
        role="listbox"
        aria-label="Countries"
        data-lenis-prevent
        hidden={!open || matches.length === 0}
        className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-64 overflow-y-auto overscroll-contain rounded-2xl bg-card p-1.5 shadow-[0_12px_32px_-12px_hsl(var(--foreground)/.3)] ring-1 ring-foreground/[0.08]"
      >
        {matches.map((c, i) => (
          <li
            key={c}
            id={`${list}-${i}`}
            data-i={i}
            role="option"
            aria-selected={c === value}
            // mousedown, not click: the input must not blur (and close the list) before the pick lands
            onMouseDown={(e) => {
              e.preventDefault();
              pick(c);
            }}
            onMouseMove={() => active !== i && setActive(i)}
            className={cn("flex min-h-11 cursor-pointer items-center rounded-xl px-3 text-[15px]", i === active && "bg-secondary", c === value && "font-medium")}
          >
            {c}
          </li>
        ))}
      </ul>
    </div>
  );
}
