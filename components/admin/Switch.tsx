"use client";
import { useId, type CSSProperties, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Switch as BaseSwitch } from "@/components/settings/notifications/parts";

/**
 * R1269: the admin uses the same lime switch as Settings (role="switch", Space/Enter, 180ms knob) instead of a
 * hand-rolled toggle per panel. The settings switch reads its line from --nf-line, which only exists under .nf,
 * so the wrapper supplies the admin's border as that value; everything else is the shared control.
 */
export type SwitchProps = ComponentProps<typeof BaseSwitch>;
const LINE = { "--nf-line": "var(--border)" } as CSSProperties;
export function Switch(props: SwitchProps) {
  return (
    <span className="inline-flex shrink-0" style={LINE}>
      <BaseSwitch {...props} />
    </span>
  );
}

/**
 * R1270: label, optional hint and the switch at the end, the admin twin of the Settings SwitchRow. The row is a
 * <label> around the switch, so a click anywhere on the words toggles it; the row is at least 44px tall.
 */
export function SwitchRow({ id, label, hint, on, onChange, disabled, locked, lockedNote, className }: { id?: string; label: string; hint?: ReactNode; on: boolean; onChange?: (v: boolean) => void; disabled?: boolean; locked?: boolean; lockedNote?: string; className?: string }) {
  const auto = useId();
  const base = id ?? auto;
  const off = disabled || locked;
  return (
    <label style={LINE} className={cn("flex min-h-11 items-center justify-between gap-4 py-2", off ? "cursor-not-allowed" : "cursor-pointer", className)}>
      <span className="min-w-0">
        <span id={`${base}-l`} className="block text-[14px] font-medium leading-snug">
          {label}
          {locked && <span className="ml-2 inline-flex h-5 items-center rounded-full bg-secondary px-2 align-middle text-[11.5px] font-semibold text-muted-foreground">{lockedNote ?? "Always on"}</span>}
        </span>
        {hint && <span id={`${base}-d`} className="mt-0.5 block text-[12.5px] leading-relaxed text-muted-foreground">{hint}</span>}
      </span>
      <BaseSwitch on={on} onChange={onChange} label={label} describedBy={hint ? `${base}-d` : undefined} disabled={disabled} locked={locked} />
    </label>
  );
}
