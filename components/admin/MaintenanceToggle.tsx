"use client";
import { useState } from "react";
import { Construction, ExternalLink, Mail, Power, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { adminApi } from "@/lib/client/admin-api";
import { Countdown } from "@/components/maintenance/Countdown";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Pill } from "./ui";

type Site = { maintenance: boolean; message: string; eta: string; since: string; endsAt: string };

// Countdown presets in minutes. 0 = no countdown (the page shows the "Expected back" text instead).
const PRESETS: { m: number; label: string }[] = [
  { m: 15, label: "15 min" },
  { m: 30, label: "30 min" },
  { m: 60, label: "1 hour" },
  { m: 120, label: "2 hours" },
  { m: 240, label: "4 hours" },
  { m: 0, label: "No countdown" },
];
type Subs = { waiting: number; total: number };

export function MaintenanceToggle({ initial, subscribers }: { initial: Site; subscribers: Subs }) {
  const toast = useToast();
  const [site, setSite] = useState(initial);
  const [subs, setSubs] = useState(subscribers);
  const [message, setMessage] = useState(initial.message);
  const [eta, setEta] = useState(initial.eta);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  // Picked countdown length. `clock` is true once the admin touches it, so "Save text" never resets a running clock.
  const [minutes, setMinutes] = useState(60);
  const [custom, setCustom] = useState("");
  const [clock, setClock] = useState(false);
  const pick = (m: number) => {
    setMinutes(m);
    setCustom("");
    setClock(true);
  };

  async function save(on: boolean) {
    setBusy(true);
    try {
      const r = await adminApi<{ site: Site; notified: number; subscribers: Subs }>("/api/admin/site", { method: "PUT", json: { maintenance: on, message, eta, ...(clock || on !== site.maintenance ? { minutes: on ? minutes : 0 } : {}) } });
      setSite(r.site);
      setSubs(r.subscribers);
      setClock(false);
      toast(on === site.maintenance ? "Saved" : on ? "Maintenance is ON. Members keep working; new visitors see the 'back soon' page." : `Site is live again. ${r.notified} subscriber${r.notified === 1 ? "" : "s"} emailed.`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      setAsk(false);
    }
  }

  const on = site.maintenance;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <Card>
        <CardTitle hint={on ? `On since ${new Date(site.since).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}` : "The site is open to everyone."} action={<Pill tone={on ? "warn" : "ok"}>{on ? "Maintenance ON" : "Live"}</Pill>}>
          Site switch
        </CardTitle>
        <div className={cn("flex flex-wrap items-center justify-between gap-4 rounded-[20px] p-4 hairline", on ? "bg-warning/10" : "bg-secondary/40")}>
          <div className="flex items-center gap-3">
            <span className={cn("grid h-11 w-11 place-items-center rounded-2xl", on ? "bg-warning/20 text-warning" : "bg-success/15 text-success")}>
              {on ? <Construction className="h-5 w-5" aria-hidden /> : <Power className="h-5 w-5" aria-hidden />}
            </span>
            <div>
              <p className="font-display text-[15px] font-semibold">{on ? "New visitors see the maintenance page" : "Everything is running"}</p>
              <p className="text-[12.5px] text-muted-foreground">{on ? "Members who joined before it started keep posting. Sign-ups are closed." : "Turn on before a risky deploy or a database change."}</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Maintenance mode"
            disabled={busy}
            onClick={() => (on ? save(false) : setAsk(true))}
            className={cn("relative inline-flex h-9 w-16 shrink-0 items-center rounded-full transition-colors duration-300 disabled:opacity-60", on ? "bg-warning" : "bg-foreground/20")}
          >
            <span className={cn("inline-block h-7 w-7 rounded-full bg-white shadow transition-transform duration-300", on ? "translate-x-8" : "translate-x-1")} />
          </button>
        </div>

        {on && site.endsAt && (
          <div className="mt-4 rounded-[18px] bg-secondary/50 px-4 py-3 hairline">
            <Countdown endsAt={site.endsAt} since={site.since} variant="bar" className="justify-start text-left" />
          </div>
        )}

        <fieldset className="mt-5">
          <legend className="flex items-center gap-1.5 text-[13px] font-medium">
            <Timer className="h-4 w-4 text-muted-foreground" aria-hidden /> Countdown on the page
          </legend>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {on ? "Pick a new length and press Save to restart the clock from now." : "Starts the moment you switch maintenance on."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PRESETS.map((p) => {
              const active = !custom && minutes === p.m;
              return (
                <button
                  key={p.m}
                  type="button"
                  aria-pressed={active}
                  onClick={() => pick(p.m)}
                  className={cn("min-h-[40px] rounded-full px-3.5 text-[13px] font-medium transition-colors", active ? "bg-foreground text-background" : "hairline hover:bg-secondary")}
                >
                  {p.label}
                </button>
              );
            })}
            <label className="fw-ring flex min-h-[40px] items-center gap-1.5 rounded-full px-3 text-[13px] hairline">
              <span className="text-muted-foreground">Custom</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={10080}
                value={custom}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 5);
                  setCustom(v);
                  const n = Math.min(10080, Number(v) || 0);
                  if (n > 0) {
                    setMinutes(n);
                    setClock(true);
                  }
                }}
                aria-label="Custom countdown in minutes"
                placeholder="45"
                className="w-14 bg-transparent text-right tabular outline-none"
              />
              <span className="text-muted-foreground">min</span>
            </label>
          </div>
        </fieldset>

        <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_200px]">
          <div>
            <Label htmlFor="mt-msg">Message on the page <span className="text-[11.5px]">{message.length}/280</span></Label>
            <Input id="mt-msg" maxLength={280} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="We're upgrading the publishing engine. Back shortly." />
          </div>
          <div>
            <Label htmlFor="mt-eta">Expected back <span className="text-[11.5px]">(no countdown)</span></Label>
            <Input id="mt-eta" maxLength={60} value={eta} onChange={(e) => setEta(e.target.value)} placeholder="about 30 minutes" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="subtle" disabled={busy || (message === site.message && eta === site.eta && !(on && clock))} onClick={() => save(on)}>{on && clock ? "Save and restart clock" : "Save text"}</Button>
          {on && (
            <a href="/maintenance?preview" target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium hairline hover:bg-secondary">
              Preview the page <ExternalLink className="h-3.5 w-3.5" aria-hidden /><span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </div>
      </Card>

      <Card>
        <CardTitle hint="People who left their email on the maintenance page.">Waiting for the all-clear</CardTitle>
        <div className="flex items-end gap-3">
          <p className="font-display text-[2.6rem] font-bold leading-none tabular">{subs.waiting}</p>
          <p className="pb-1 text-[13px] text-muted-foreground">waiting · {subs.total} all time</p>
        </div>
        <p className="mt-4 flex items-start gap-2 text-[13px] leading-relaxed text-muted-foreground">
          <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          When you switch maintenance off, each of them gets one &quot;We&apos;re back online&quot; email through your email provider (Integrations). With Mock email they land in the Outbox.
        </p>
      </Card>

      <ConfirmDialog
        open={ask}
        onOpenChange={setAsk}
        title="Take the site offline?"
        body={`New visitors see the maintenance page right away and nobody can sign up. Members who already have an account keep working and posting.${minutes ? ` The page counts down ${minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minutes`}.` : ""}`}
        confirmLabel="Turn maintenance on"
        busy={busy}
        onConfirm={() => save(true)}
      />
    </div>
  );
}
