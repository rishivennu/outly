"use client";
import { useState } from "react";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import { cooldownFor, type InstallConfig } from "@/lib/pwa-core";
import { cn } from "@/lib/utils";
import { Card, CardTitle } from "./ui";

const VISITS = [1, 2, 3, 5];
const DELAYS = [10, 20, 30, 60];
const COOLDOWNS = [7, 14, 21, 30, 60];
const MAX = [1, 2, 3, 5];

/**
 * Admin > Dashboard style > Home Screen suggestion (1099). The phone-only "Add Outlly to your Home Screen"
 * card in the studio. Saves at once (optimistic, rolls back on error), like the cards above.
 */
export function InstallPromptSettings({ initial }: { initial: InstallConfig }) {
  const toast = useToast();
  const [cfg, setCfg] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function save(patch: Partial<InstallConfig>, msg: string) {
    if (busy) return;
    const prev = cfg;
    setCfg({ ...cfg, ...patch });
    setBusy(true);
    try {
      const r = await adminApi<{ install: InstallConfig }>("/api/admin/install", { method: "PUT", json: patch });
      setCfg(r.install);
      toast(msg);
    } catch (e) {
      setCfg(prev);
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const select = (label: string, value: number, opts: number[], unit: (n: number) => string, k: keyof InstallConfig) => (
    <label className="grid gap-1.5 text-[13px] font-medium">
      {label}
      <select
        value={value}
        disabled={busy || !cfg.enabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          void save({ [k]: n } as Partial<InstallConfig>, `${label}: ${unit(n)}.`);
        }}
        className="h-11 rounded-xl bg-background px-3 text-[14px] hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
      >
        {[...new Set([...opts, value])].sort((a, b) => a - b).map((n) => (
          <option key={n} value={n}>{unit(n)}</option>
        ))}
      </select>
    </label>
  );

  const s = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const ladder = Array.from({ length: cfg.maxDismissals }, (_, i) => cooldownFor(i + 1, cfg));
  return (
    <Card>
      <CardTitle hint="Phones only, in the browser. Android gets its own install prompt; iPhone and iPad get the three Share steps. Never shown inside the Android app, once Outlly is installed, or in Instagram and other in-app browsers.">
        Home Screen suggestion
      </CardTitle>
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-2xl bg-secondary/40 px-4 py-3 hairline focus-within:ring-2 focus-within:ring-ring">
        <span className="text-[14px] font-medium">Suggest &ldquo;Add Outlly to your Home Screen&rdquo;</span>
        <input
          type="checkbox"
          role="switch"
          checked={cfg.enabled}
          disabled={busy}
          aria-checked={cfg.enabled}
          onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? "Home Screen suggestion on." : "Home Screen suggestion off for everyone.")}
          className="peer sr-only"
        />
        <span aria-hidden className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200", cfg.enabled ? "bg-lime" : "bg-foreground/20")}>
          <span className={cn("absolute top-1 h-5 w-5 rounded-full bg-background shadow transition-transform duration-200 motion-reduce:transition-none", cfg.enabled ? "translate-x-6" : "translate-x-1")} />
        </span>
      </label>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {select("First shown on visit", cfg.minVisits, VISITS, (n) => (n === 1 ? "The first visit" : `Visit ${n}`), "minVisits")}
        {select("Wait on the page", cfg.delaySec, DELAYS, (n) => s(n, "second"), "delaySec")}
        {select("After Not now, wait", cfg.cooldownDays, COOLDOWNS, (n) => s(n, "day"), "cooldownDays")}
        {select("Stop after", cfg.maxDismissals, MAX, (n) => s(n, "dismissal"), "maxDismissals")}
      </div>
      <p className="mt-3 text-[13px] text-muted-foreground">
        {cfg.enabled
          ? `Shows on Home, Calendar, Content, Analytics or Inbox after ${s(cfg.delaySec, "second")} with nothing else open, never during Create. Waits ${ladder.map((d) => s(d, "day")).join(", then ")} after each Not now, then stops on that browser.`
          : "Off: nobody sees the card. People can still add Outlly from their browser menu."}
      </p>
    </Card>
  );
}
