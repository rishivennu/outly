"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import { useToast } from "@/components/shared/Toast";
import { NAV_TILES, NavPreview } from "@/components/settings/NavStylePref";
import { adminApi } from "@/lib/client/admin-api";
import type { NavConfig, NavStyle } from "@/lib/nav-config";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Pill } from "./ui";
import { Switch } from "./Switch";

/**
 * Admin > Dashboard style > Navigation (R1290): the desktop navigation everyone gets by default, and whether people
 * may pick their own in Settings > Personalization. Saves at once (optimistic, rolls back on error), like the
 * dashboard picker above it.
 */
export function NavStylePicker({ initial }: { initial: NavConfig }) {
  const toast = useToast();
  const [cfg, setCfg] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function save(patch: Partial<NavConfig>, done: (c: NavConfig) => string) {
    if (busy) return;
    const prev = cfg;
    setCfg({ ...cfg, ...patch });
    setBusy(true);
    try {
      const r = await adminApi<{ nav: NavConfig }>("/api/admin/nav", { method: "PUT", json: patch });
      setCfg(r.nav);
      toast(done(r.nav));
    } catch (e) {
      setCfg(prev);
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  const name = (s: NavStyle) => NAV_TILES.find((x) => x.id === s)!.name;

  return (
    <div className="grid gap-5">
      <Card>
        <CardTitle hint="Desktop only: phones keep the tab bar. Applies to every studio within 15 seconds.">Default navigation</CardTitle>
        <fieldset disabled={busy}>
          <legend className="sr-only">Default navigation for everyone</legend>
          <div className="grid gap-3 md:grid-cols-2">
            {NAV_TILES.map((t) => {
              const on = cfg.style === t.id;
              return (
                <label key={t.id} className={cn("relative flex cursor-pointer flex-col gap-3 rounded-3xl bg-secondary/40 p-5 transition-shadow focus-within:ring-2 focus-within:ring-ring", on && "ring-1 ring-inset ring-lime/40")}>
                  <input type="radio" name="nav-style-default" value={t.id} checked={on} onChange={() => save({ style: t.id }, (c) => `Everyone now gets the ${name(c.style)}${c.userSwitch ? " unless they picked their own" : ""}.`)} className="sr-only" />
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold">{t.name}</span>
                      <Pill>{t.tag}</Pill>
                    </span>
                    {on && <Pill tone="ok"><Check className="h-3 w-3" aria-hidden />{busy ? "Saving" : "Live"}</Pill>}
                  </span>
                  <NavPreview id={t.id} />
                  <span className="text-[13.5px] text-muted-foreground">{t.body}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </Card>
      <Card>
        <CardTitle hint="On: each person can pick the Sidebar or the Dock in Settings > Personalization, and their browser keeps it. Off: everyone gets the default above.">Let people switch</CardTitle>
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-2xl bg-secondary/40 px-4 py-3">
          <span className="text-[14px] font-medium">Let people pick their own navigation</span>
          <Switch on={cfg.userSwitch} disabled={busy} label="Let people pick their own navigation" onChange={(v) => save({ userSwitch: v }, (c) => (c.userSwitch ? "People can now pick their own navigation in Settings." : `Locked. Everyone gets the ${name(c.style)}.`))} />
        </label>
      </Card>
    </div>
  );
}
