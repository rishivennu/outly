"use client";
import { Check } from "lucide-react";
import { Card, Pill } from "@/components/admin/ui";
import { ADMIN_DESIGNS, DESIGN_LABEL, type AdminDesign } from "@/lib/admin/design";
import { cn } from "@/lib/utils";
import { useDesignSwitch } from "./DesignSwitch";

/**
 * R1304: the console design picker on My account. Two tiles, Classic and Aurora, each with a small drawing of its
 * layout. Picking one writes the preference (cookie + localStorage) and cross-fades the whole console into the
 * other shell; the page, its data and the light or dark theme stay as they were. Each design keeps its own light
 * and dark looks: the theme control works the same in both.
 */
function Preview({ id }: { id: AdminDesign }) {
  const bar = "bg-foreground/15";
  if (id === "classic") {
    return (
      <span aria-hidden className="flex h-[88px] gap-1.5 rounded-2xl bg-background/80 p-2 ring-1 ring-inset ring-border/50">
        <span className="flex w-[22%] flex-col gap-1 rounded-xl bg-secondary p-1.5">
          <span className={cn("h-1.5 w-3/4 rounded-full", bar)} />
          <span className="h-1.5 w-full rounded-full bg-lime" />
          <span className={cn("h-1.5 w-full rounded-full", bar)} />
          <span className={cn("h-1.5 w-5/6 rounded-full", bar)} />
        </span>
        <span className="flex flex-1 flex-col gap-1.5">
          <span className={cn("h-2 w-1/2 rounded-full", bar)} />
          <span className="grid flex-1 grid-cols-3 gap-1.5">
            <span className="rounded-lg bg-card shadow-sm" />
            <span className="rounded-lg bg-card shadow-sm" />
            <span className="rounded-lg bg-card shadow-sm" />
          </span>
          <span className="h-[30%] rounded-lg bg-card shadow-sm" />
        </span>
      </span>
    );
  }
  return (
    <span aria-hidden className="flex h-[88px] flex-col gap-1.5 rounded-2xl bg-[linear-gradient(135deg,hsl(var(--lime)/.18),hsl(var(--background)))] p-2 ring-1 ring-inset ring-border/50">
      <span className="flex items-center justify-center gap-1">
        <span className={cn("h-2.5 w-7 rounded-full", bar)} />
        <span className="h-2.5 w-7 rounded-full bg-foreground" />
        <span className={cn("h-2.5 w-7 rounded-full", bar)} />
        <span className={cn("h-2.5 w-7 rounded-full", bar)} />
      </span>
      <span className="grid flex-1 grid-cols-[2fr_1fr] gap-1.5">
        <span className="flex flex-col gap-1.5">
          <span className="flex-1 rounded-xl bg-card lime-glow" />
          <span className="grid h-[38%] grid-cols-3 gap-1.5">
            <span className="rounded-lg bg-card shadow-sm" />
            <span className="rounded-lg bg-card shadow-sm" />
            <span className="rounded-lg bg-card shadow-sm" />
          </span>
        </span>
        <span className="rounded-xl bg-card shadow-sm" />
      </span>
    </span>
  );
}

const POINTS: Record<AdminDesign, string[]> = {
  classic: ["Grouped sidebar, or the dock", "Light and dark", "Everything exactly where it has been"],
  aurora: ["Navigation along the top, sections as tabs", "Light and dark, each tuned on its own", "Greeting card, stat cards and highlights on Overview"],
};

export function DesignPicker({ current }: { current: AdminDesign }) {
  const { switchTo, pending } = useDesignSwitch();
  return (
    <Card data-design-picker>
      <p id="design-picker-hint" className="mb-4 max-w-[62ch] text-[13.5px] leading-normal text-muted-foreground">
        Your pick, remembered on this browser for a year. Every page, number and setting is the same in both; only the look and the navigation change. Light and dark keep working in each.
      </p>
      <fieldset aria-busy={pending || undefined} aria-describedby="design-picker-hint">
        <legend className="sr-only">Console design</legend>
        <div className="grid gap-3 md:grid-cols-2">
          {ADMIN_DESIGNS.map((d) => {
            const on = current === d;
            return (
              <label key={d} className={cn("relative flex cursor-pointer flex-col gap-3 rounded-3xl bg-secondary/40 p-5 transition-shadow focus-within:ring-2 focus-within:ring-ring", on && "ring-1 ring-inset ring-lime/40")}>
                <input type="radio" name="admin-design" value={d} checked={on} onChange={() => void switchTo(d, "picker")} className="sr-only" />
                <span className="flex items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold">{DESIGN_LABEL[d].name}</span>
                    {d === "classic" && <Pill>Original</Pill>}
                    {d === "aurora" && <Pill tone="lime">New</Pill>}
                  </span>
                  {on && (
                    <Pill tone="ok">
                      <Check className="h-3 w-3" aria-hidden />
                      {pending ? "Switching" : "In use"}
                    </Pill>
                  )}
                </span>
                <Preview id={d} />
                <span className="text-[13.5px] text-muted-foreground">{DESIGN_LABEL[d].hint}</span>
                <ul className="grid gap-1 text-[13px] text-muted-foreground">
                  {POINTS[d].map((p) => (
                    <li key={p} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime-ink" aria-hidden />
                      {p}
                    </li>
                  ))}
                </ul>
              </label>
            );
          })}
        </div>
      </fieldset>
    </Card>
  );
}
