"use client";
import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/** Lime switch (180ms). A real button with role="switch", so Space and Enter work and screen readers say on/off. */
export function Switch({ on, onChange, label, describedBy, disabled, locked }: { on: boolean; onChange?: (v: boolean) => void; label: string; describedBy?: string; disabled?: boolean; locked?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled || locked}
      onClick={() => onChange?.(!on)}
      className={cn("nf-switch", on && "is-on", locked && "is-locked")}
    >
      <span className="nf-knob" aria-hidden="true">{locked && <Lock className="h-2.5 w-2.5" />}</span>
    </button>
  );
}

/** A labelled row with a switch at the end (whole row is 44px+ tall). */
export function SwitchRow({ id, label, hint, on, onChange, disabled, locked, lockedNote }: { id: string; label: string; hint?: string; on: boolean; onChange?: (v: boolean) => void; disabled?: boolean; locked?: boolean; lockedNote?: string }) {
  return (
    <div className="flex min-h-[56px] items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p id={`${id}-l`} className="text-[15px] font-medium leading-snug">
          {label}
          {locked && <span className="ml-2 inline-flex h-5 items-center rounded-full bg-secondary px-2 align-middle text-xs font-semibold text-muted-foreground">{lockedNote ?? "Always on"}</span>}
        </p>
        {hint && <p id={`${id}-d`} className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex min-h-[44px] shrink-0 items-center">
        <Switch on={on} onChange={onChange} label={label} describedBy={hint ? `${id}-d` : undefined} disabled={disabled} locked={locked} />
      </div>
    </div>
  );
}

/** Height animates open and shut (250ms) with grid rows, so nothing is measured in JS. Content leaves the tab order when closed. */
export function Expand({ open, children, id }: { open: boolean; children: React.ReactNode; id?: string }) {
  return (
    <div id={id} className={cn("nf-expand", open && "is-open")} inert={!open || undefined}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/** A small single-choice dropdown (200ms), built on the Radix popover so focus and Escape behave. */
export function Choice<T extends string | number>({ value, options, onChange, label, disabled, format }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string; disabled?: boolean; format: (v: T) => string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild disabled={disabled}>
        <button type="button" aria-label={`${label}: ${format(value)}`} className="nf-select">
          <span>{format(value)}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform duration-200", open && "rotate-180")} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="nf-menu z-[90]" aria-label={label}>
          <div role="radiogroup" aria-label={label} className="flex flex-col">
            {options.map((o) => (
              <button
                key={String(o)}
                type="button"
                role="radio"
                aria-checked={o === value}
                onClick={() => {
                  onChange(o);
                  setOpen(false);
                }}
                className={cn("nf-menu-item", o === value && "is-on")}
              >
                <span className="flex-1 text-left">{format(o)}</span>
                {o === value && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ago(iso: string, now = Date.now()) {
  const m = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: d > 300 ? "numeric" : undefined }).format(new Date(iso));
}
