"use client";
import { useState } from "react";
import { BellRing } from "lucide-react";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";
import { SPIKE_STEPS, type AlertPrefs } from "@/lib/alerts-core";
import { cn } from "@/lib/utils";

function Toggle({ id, label, hint, on, disabled, onChange }: { id: string; label: string; hint: string; on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p id={`${id}-l`} className="text-[15px] font-medium">{label}</p>
        <p id={`${id}-d`} className="mt-0.5 text-[13px] text-muted-foreground">{hint}</p>
      </div>
      <label className="flex min-h-[44px] shrink-0 cursor-pointer items-center">
        <input type="checkbox" role="switch" checked={on} disabled={disabled} aria-labelledby={`${id}-l`} aria-describedby={`${id}-d`} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        <span aria-hidden className="relative h-7 w-12 shrink-0 rounded-full bg-muted transition-colors peer-checked:bg-lime peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-disabled:opacity-60 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-background after:shadow after:transition-transform after:duration-300 peer-checked:after:translate-x-5 motion-reduce:after:transition-none" />
      </label>
    </div>
  );
}

/** Custom alerts (1037): engagement spikes and failed posts. Saved one switch at a time, rolled back if the save fails. */
export function AlertsCard({ initial }: { initial: AlertPrefs }) {
  const toast = useToast();
  const [p, setP] = useState(initial);
  const [saving, setSaving] = useState(false);
  const save = async (patch: Partial<AlertPrefs>, done: string) => {
    const before = p;
    setP({ ...p, ...patch });
    setSaving(true);
    try {
      const r = await api<{ prefs: AlertPrefs }>("/api/settings/alerts", { method: "PATCH", json: patch });
      setP(r.prefs);
      toast(done, "ok");
    } catch (err) {
      setP(before);
      toast(err instanceof ApiError ? err.message : "Something got in the way.", "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="glass flex h-full flex-col rounded-[32px] p-6 sm:p-8" aria-labelledby="al-h">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-secondary/70 hairline" aria-hidden="true">
          <BellRing className="h-5 w-5" />
        </span>
        <div>
          <h2 id="al-h" className="text-2xl font-semibold tracking-tight">Alerts</h2>
          <p className="mt-1 text-sm text-muted-foreground">In the bell and on your phone. Each account alerts at most once a day.</p>
        </div>
      </div>
      <div className="mt-4 divide-y divide-border">
        <Toggle id="al-failed" label="A scheduled post fails" hint="Once per post, with an email the first time. Reconnect alerts always stay on." on={p.failed} disabled={saving} onChange={(v) => save({ failed: v }, v ? "Failure alerts on." : "Failure alerts off.")} />
        <Toggle id="al-spike" label="Engagement spikes" hint="When an account's views in a day jump well past its usual." on={p.spike} disabled={saving} onChange={(v) => save({ spike: v }, v ? "Spike alerts on." : "Spike alerts off.")} />
        {p.spike && (
          <>
            <fieldset className="py-3">
              <legend className="text-[15px] font-medium">Count it as a spike at</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {SPIKE_STEPS.map((x) => (
                  <label key={x} className={cn("inline-flex min-h-[44px] cursor-pointer items-center rounded-full px-4 text-sm font-medium hairline transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2", p.spikeX === x ? "bg-lime text-[hsl(var(--lime-foreground))]" : "hover:bg-secondary")}>
                    <input type="radio" name="al-x" value={x} checked={p.spikeX === x} disabled={saving} onChange={() => save({ spikeX: x }, `Spikes now start at ${x}x a normal day.`)} className="sr-only" />
                    {x}x a normal day
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[13px] text-muted-foreground">Days under 100 views never count, so a quiet account doesn't buzz you over a handful.</p>
            </fieldset>
            <Toggle id="al-email" label="Email me spikes too" hint="Off by default. Failures email regardless while that alert is on." on={p.email} disabled={saving} onChange={(v) => save({ email: v }, v ? "Spike emails on." : "Spike emails off.")} />
          </>
        )}
      </div>
    </section>
  );
}
