"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import type { DashboardConfig, DashboardStyle } from "@/lib/dashboard-config";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Pill } from "./ui";

const STYLES: { id: DashboardStyle; name: string; body: string; points: string[] }[] = [
  {
    id: "classic",
    name: "Classic",
    body: "The Home people know today: greeting, what is sending, the week, next steps, ideas and recycling.",
    points: ["Everything on Home as it was", "Sidebar as it was", "Settings > Sessions with Sign out everywhere"],
  },
  {
    id: "pulse",
    name: "Analytics dashboard",
    body: "Numbers first: rolling KPI cards, a views chart that redraws per range and platform, top posts and the platform split.",
    points: ["Animated sidebar icons and a gliding hover", "7D, 30D and 90D, per platform", "Settings > Active sessions, one device at a time"],
  },
];

/** Thumbnail of each layout, drawn in CSS so it follows the theme. Decorative. */
function Preview({ id }: { id: DashboardStyle }) {
  const bar = "rounded-full bg-foreground/15";
  return (
    <span aria-hidden className="flex h-28 gap-2 overflow-hidden rounded-2xl bg-background/60 p-2.5 hairline">
      <span className="flex w-10 flex-col gap-1.5 rounded-xl bg-secondary/70 p-1.5">
        {[0, 1, 2, 3, 4].map((i) => <span key={i} className={cn("h-1.5", i === 0 && id === "pulse" ? "rounded-full bg-lime" : bar)} />)}
      </span>
      {id === "classic" ? (
        <span className="flex flex-1 flex-col gap-1.5">
          <span className="h-5 w-2/3 rounded-lg bg-foreground/20" />
          <span className="h-8 rounded-xl bg-secondary/80" />
          <span className="flex flex-1 gap-1.5"><span className="flex-[7] rounded-xl bg-secondary/80" /><span className="flex-[5] rounded-xl bg-secondary/80" /></span>
        </span>
      ) : (
        <span className="flex flex-1 flex-col gap-1.5">
          <span className="grid grid-cols-4 gap-1.5">{[0, 1, 2, 3].map((i) => <span key={i} className="h-6 rounded-lg bg-secondary/80" />)}</span>
          <span className="flex flex-1 gap-1.5">
            <span className="relative flex-[2] overflow-hidden rounded-xl bg-secondary/80">
              <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-3/4 w-full"><path d="M0 34 L20 30 L40 22 L60 24 L80 12 L100 8 L100 40 L0 40Z" fill="hsl(var(--lime) / 0.25)" /><path d="M0 34 L20 30 L40 22 L60 24 L80 12 L100 8" fill="none" stroke="hsl(var(--lime))" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>
            </span>
            <span className="flex-1 rounded-xl bg-secondary/80" />
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * Admin > Dashboard style (1080). The default for everyone, and whether people may switch on their own browser.
 * Saves at once (optimistic, rolls back on error), like Site fonts.
 */
export function DashboardStylePicker({ initial }: { initial: DashboardConfig }) {
  const toast = useToast();
  const [cfg, setCfg] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function save(patch: Partial<DashboardConfig>, done: (c: DashboardConfig) => string) {
    if (busy) return;
    const prev = cfg;
    setCfg({ ...cfg, ...patch });
    setBusy(true);
    try {
      const r = await adminApi<{ dashboard: DashboardConfig }>("/api/admin/dashboard", { method: "PUT", json: patch });
      setCfg(r.dashboard);
      toast(done(r.dashboard));
    } catch (e) {
      setCfg(prev);
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  const name = (s: DashboardStyle) => STYLES.find((x) => x.id === s)!.name;

  return (
    <div className="grid gap-5">
      <Card>
        <CardTitle hint="Applies to every studio within 15 seconds. Nobody loses data either way: both read the same posts and numbers.">Default dashboard</CardTitle>
        <fieldset disabled={busy}>
          <legend className="sr-only">Default dashboard for everyone</legend>
          <div className="grid gap-3 md:grid-cols-2">
            {STYLES.map((s) => {
              const on = cfg.style === s.id;
              return (
                <label key={s.id} className={cn("relative flex cursor-pointer flex-col gap-3 rounded-3xl bg-secondary/40 p-5 hairline transition-shadow focus-within:ring-2 focus-within:ring-ring", on && "ring-2 ring-foreground/70")}>
                  <input type="radio" name="dash-style" value={s.id} checked={on} onChange={() => save({ style: s.id }, (c) => `Everyone now gets the ${name(c.style)} dashboard${c.userSwitch ? " unless they picked their own" : ""}.`)} className="sr-only" />
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold">{s.name}</span>
                      {s.id === "classic" && <Pill>Original</Pill>}
                    </span>
                    {on && <Pill tone="ok"><Check className="h-3 w-3" aria-hidden />{busy ? "Saving" : "Live"}</Pill>}
                  </span>
                  <Preview id={s.id} />
                  <span className="text-[13.5px] text-muted-foreground">{s.body}</span>
                  <ul className="grid gap-1 text-[13px] text-muted-foreground">
                    {s.points.map((p) => <li key={p} className="flex items-start gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime-ink" aria-hidden />{p}</li>)}
                  </ul>
                </label>
              );
            })}
          </div>
        </fieldset>
      </Card>
      <Card>
        <CardTitle hint="On: a small Classic / Analytics switch appears on Home and each browser keeps its own pick. Off: everyone sees the default above.">Let people switch</CardTitle>
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-2xl bg-secondary/40 px-4 py-3 hairline focus-within:ring-2 focus-within:ring-ring">
          <span className="text-[14px] font-medium">Show the dashboard switch on Home</span>
          <input
            type="checkbox"
            role="switch"
            checked={cfg.userSwitch}
            disabled={busy}
            aria-checked={cfg.userSwitch}
            onChange={(e) => save({ userSwitch: e.target.checked }, (c) => (c.userSwitch ? "People can now switch dashboards from Home." : `Switch hidden. Everyone sees the ${name(c.style)} dashboard.`))}
            className="peer sr-only"
          />
          <span aria-hidden className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200", cfg.userSwitch ? "bg-lime" : "bg-foreground/20")}>
            <span className={cn("absolute top-1 h-5 w-5 rounded-full bg-background shadow transition-transform duration-200 motion-reduce:transition-none", cfg.userSwitch ? "translate-x-6" : "translate-x-1")} />
          </span>
        </label>
      </Card>
    </div>
  );
}
