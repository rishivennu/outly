"use client";
import { useState } from "react";
import { Construction, ExternalLink, Mail, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { adminApi } from "@/lib/client/admin-api";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Pill } from "./ui";

type Site = { maintenance: boolean; message: string; eta: string; since: string };
type Subs = { waiting: number; total: number };

export function MaintenanceToggle({ initial, subscribers }: { initial: Site; subscribers: Subs }) {
  const toast = useToast();
  const [site, setSite] = useState(initial);
  const [subs, setSubs] = useState(subscribers);
  const [message, setMessage] = useState(initial.message);
  const [eta, setEta] = useState(initial.eta);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);

  async function save(on: boolean) {
    setBusy(true);
    try {
      const r = await adminApi<{ site: Site; notified: number; subscribers: Subs }>("/api/admin/site", { method: "PUT", json: { maintenance: on, message, eta } });
      setSite(r.site);
      setSubs(r.subscribers);
      toast(on === site.maintenance ? "Saved" : on ? "Maintenance is ON. Customers now see the 'back soon' page." : `Site is live again. ${r.notified} subscriber${r.notified === 1 ? "" : "s"} emailed.`);
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
        <CardTitle hint={on ? `On since ${new Date(site.since).toLocaleString()}` : "The site is open to everyone."} action={<Pill tone={on ? "warn" : "ok"}>{on ? "Maintenance ON" : "Live"}</Pill>}>
          Site switch
        </CardTitle>
        <div className={cn("flex flex-wrap items-center justify-between gap-4 rounded-[20px] p-4 hairline", on ? "bg-warning/10" : "bg-secondary/40")}>
          <div className="flex items-center gap-3">
            <span className={cn("grid h-11 w-11 place-items-center rounded-2xl", on ? "bg-warning/20 text-warning" : "bg-success/15 text-success")}>
              {on ? <Construction className="h-5 w-5" aria-hidden /> : <Power className="h-5 w-5" aria-hidden />}
            </span>
            <div>
              <p className="font-display text-[15px] font-semibold">{on ? "Customers see the maintenance page" : "Everything is running"}</p>
              <p className="text-[12.5px] text-muted-foreground">{on ? "Admins bypass it. Sign-in, uploads and publishing are paused." : "Turn on before a risky deploy or a database change."}</p>
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

        <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_200px]">
          <div>
            <Label htmlFor="mt-msg">Message on the page <span className="text-[11.5px]">{message.length}/280</span></Label>
            <Input id="mt-msg" maxLength={280} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="We're upgrading the publishing engine. Back shortly." />
          </div>
          <div>
            <Label htmlFor="mt-eta">Expected back</Label>
            <Input id="mt-eta" maxLength={60} value={eta} onChange={(e) => setEta(e.target.value)} placeholder="about 30 minutes" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="subtle" disabled={busy || (message === site.message && eta === site.eta)} onClick={() => save(on)}>Save text</Button>
          {on && (
            <a href="/maintenance" target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium hairline hover:bg-secondary">
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
        body="Customers will see the maintenance page right away and can't sign in, upload or publish until you switch it back. Scheduled posts wait and go out afterwards."
        confirmLabel="Turn maintenance on"
        busy={busy}
        onConfirm={() => save(true)}
      />
    </div>
  );
}
