"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DoorOpen, ExternalLink, Hourglass, Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { adminApi } from "@/lib/client/admin-api";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Pill, ago } from "./ui";

export type WaitlistCounts = { total: number; waiting: number; invited: number; today: number; week: number; month: number; last24h: number; latestAt: string | null };
export type WaitlistState = { waitlist: boolean; since: string; counts: WaitlistCounts };

const ist = (d: string) => new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

/**
 * The waitlist page's top half (1142): an overview that is always on screen whatever the switch says (total,
 * today, this week, this month, latest join), then the switch and the invite button. The member table below it is
 * server-rendered from the URL, so its filters survive refresh and back. Every action refreshes the server data,
 * and the page re-reads the database every 30 s (AutoRefresh), so a new join shows up without a reload.
 */
export function WaitlistToggle({ initial }: { initial: WaitlistState }) {
  const toast = useToast();
  const router = useRouter();
  const [, start] = useTransition();
  const [st, setSt] = useState(initial);
  // The server re-rendered (refresh, filter change, AutoRefresh): take its numbers.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setSt(initial);
  }
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<null | "on" | "off" | "all">(null);
  const [inviteOnOff, setInviteOnOff] = useState(true);

  async function run(key: string, init: { method: "PUT" | "POST"; json: unknown }, msg: (r: WaitlistState & { invited: number }) => string) {
    setBusy(key);
    try {
      const r = await adminApi<WaitlistState & { invited: number }>("/api/admin/waitlist", init);
      setSt({ waitlist: r.waitlist, since: r.since, counts: r.counts });
      toast(msg(r));
      start(() => router.refresh());
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
      setAsk(null);
    }
  }

  const turn = (on: boolean) =>
    run("switch", { method: "PUT", json: { waitlist: on, inviteAll: !on && inviteOnOff } }, (r) =>
      on ? "Waitlist is ON. New visitors join the line instead of signing up." : `Signups are open again.${r.invited ? ` ${r.invited} invite${r.invited === 1 ? "" : "s"} emailed.` : ""}`,
    );
  const inviteAll = () => run("all", { method: "POST", json: {} }, (r) => (r.invited ? `${r.invited} invite${r.invited === 1 ? "" : "s"} emailed` : "Nobody to invite"));

  const on = st.waitlist;
  const c = st.counts;
  const tiles: [string, number, string][] = [
    ["Total registered", c.total, "Everyone on the list"],
    ["Today", c.today, "Since midnight IST"],
    ["This week", c.week, "Since Monday"],
    ["This month", c.month, "Since the 1st"],
    ["Waiting", c.waiting, "Not invited yet"],
    ["Invited", c.invited, "Invite emailed"],
  ];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card className="lg:col-span-2" aria-labelledby="wl-overview">
        <CardTitle hint="Straight from the waitlist records. The switch never hides or changes them." action={<Pill tone={on ? "info" : "ok"}>{on ? "Waitlist ON" : "Signups open"}</Pill>}>
          <span id="wl-overview">Waitlist overview</span>
        </CardTitle>
        <dl className="mb-4 grid grid-cols-1 gap-2 rounded-[20px] bg-secondary/40 p-3 text-[13.5px] hairline sm:grid-cols-3 sm:gap-4 sm:p-4" aria-label="Waitlist status">
          <div className="flex items-center justify-between gap-3 sm:block">
            <dt className="text-[12px] font-semibold text-muted-foreground">Waitlist mode</dt>
            <dd className="mt-0.5 flex items-center gap-2 font-semibold">
              <span className={cn("h-2 w-2 rounded-full", on ? "bg-accent" : "bg-success")} aria-hidden />
              {on ? "Enabled" : "Disabled"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 sm:block">
            <dt className="text-[12px] font-semibold text-muted-foreground">Total registered</dt>
            <dd className="mt-0.5 font-semibold tabular">{c.total.toLocaleString("en-IN")}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 sm:block">
            <dt className="text-[12px] font-semibold text-muted-foreground">Latest registration</dt>
            <dd className="mt-0.5 text-right font-semibold sm:text-left">
              {c.latestAt ? (
                <time dateTime={c.latestAt} title={ist(c.latestAt)}>
                  {ago(c.latestAt)} <span className="font-normal text-muted-foreground">· {ist(c.latestAt)}</span>
                </time>
              ) : (
                "Nobody yet"
              )}
            </dd>
          </div>
        </dl>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {tiles.map(([k, v, h]) => (
            <div key={k} className="min-w-0 rounded-2xl bg-secondary/50 p-3">
              <dt className="truncate text-[12px] font-semibold text-muted-foreground">{k}</dt>
              <dd className="mt-1 font-display text-[1.75rem] font-bold leading-none tabular">{v.toLocaleString("en-IN")}</dd>
              <dd className="mt-1.5 truncate text-[11.5px] text-muted-foreground">{h}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card>
        <CardTitle hint={on && st.since ? `On since ${ist(st.since)}` : "Anyone can create an account."} action={<Pill tone={on ? "info" : "ok"}>{on ? "Waitlist ON" : "Signups open"}</Pill>}>
          Waitlist switch
        </CardTitle>
        <div className={cn("flex flex-wrap items-center justify-between gap-4 rounded-[20px] p-4 hairline", on ? "bg-accent/10" : "bg-secondary/40")}>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl", on ? "bg-accent/15 text-foreground" : "bg-success/15 text-success")}>
              {on ? <Hourglass className="h-5 w-5" aria-hidden /> : <DoorOpen className="h-5 w-5" aria-hidden />}
            </span>
            <div className="min-w-0">
              <p className="font-display text-[15px] font-semibold">{on ? "New visitors join the waitlist" : "Signups are open"}</p>
              <p className="text-[12.5px] text-muted-foreground">
                {on ? "Signup buttons say “Join the waitlist”. Existing users, invitees and team invites still get in." : "Turn on to pause new accounts and collect a queue."}
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Waitlist mode"
            disabled={!!busy}
            onClick={() => setAsk(on ? "off" : "on")}
            className={cn("relative inline-flex h-9 w-16 shrink-0 items-center rounded-full transition-colors duration-300 disabled:opacity-60", on ? "bg-success" : "bg-foreground/20")}
          >
            <span className={cn("inline-block h-7 w-7 rounded-full bg-white shadow transition-transform duration-300", on ? "translate-x-8" : "translate-x-1")} />
          </button>
        </div>

        <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl px-1 py-2 text-[13.5px]">
          <input type="checkbox" checked={inviteOnOff} onChange={(e) => setInviteOnOff(e.target.checked)} className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[hsl(var(--foreground))]" />
          <span>
            <span className="font-semibold">Invite everyone waiting when I switch it off</span>
            <span className="block text-muted-foreground">Each person gets one &quot;Your Outlly invite is here&quot; email with a signup link.</span>
          </span>
        </label>

        <div className="mt-3 flex flex-wrap gap-2">
          <a href="/waitlist" target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium hairline hover:bg-secondary">
            {on ? "Open the waitlist page" : "Waitlist page (shows when on)"} <ExternalLink className="h-3.5 w-3.5" aria-hidden /><span className="sr-only">(opens in a new tab)</span>
          </a>
        </div>
      </Card>

      <Card>
        <CardTitle hint="Let people in from the line, a few at a time or all at once.">Invites</CardTitle>
        <p className="text-[13.5px]">
          <span className="font-display text-[1.9rem] font-bold leading-none tabular">{c.waiting.toLocaleString("en-IN")}</span>{" "}
          <span className="text-muted-foreground">waiting for an invite, {c.invited.toLocaleString("en-IN")} already invited.</span>
        </p>
        <Button type="button" variant="primary" className="mt-4 w-full" disabled={!!busy || c.waiting === 0} onClick={() => setAsk("all")}>
          <Send className="h-4 w-4" aria-hidden /> Invite everyone waiting ({c.waiting})
        </Button>
        <p className="mt-4 flex items-start gap-2 text-[13px] leading-relaxed text-muted-foreground">
          <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Invites go through your email provider (Integrations). With Mock email they land in the Outbox. An invited email can sign up even while the waitlist stays on.
        </p>
      </Card>

      <ConfirmDialog
        open={ask === "on"}
        onOpenChange={(o) => !o && setAsk(null)}
        title="Pause new signups?"
        body="Visitors will see the waitlist page instead of signup, and new accounts are refused until you switch it back. Existing users sign in as normal. Nobody on the list is removed."
        confirmLabel="Turn the waitlist on"
        tone="primary"
        busy={busy === "switch"}
        onConfirm={() => turn(true)}
      />
      <ConfirmDialog
        open={ask === "off"}
        onOpenChange={(o) => !o && setAsk(null)}
        title="Open signups again?"
        body={inviteOnOff && c.waiting ? `Anyone can create an account again, and ${c.waiting} ${c.waiting === 1 ? "person gets" : "people get"} an invite email now. The list itself is kept.` : "Anyone can create an account again. Nobody is emailed, and the list is kept."}
        confirmLabel="Open signups"
        tone="primary"
        busy={busy === "switch"}
        onConfirm={() => turn(false)}
      />
      <ConfirmDialog
        open={ask === "all"}
        onOpenChange={(o) => !o && setAsk(null)}
        title={`Invite ${c.waiting} ${c.waiting === 1 ? "person" : "people"}?`}
        body="Each one gets an email with a signup link, and can create an account even while the waitlist stays on."
        confirmLabel="Send invites"
        tone="primary"
        busy={busy === "all"}
        onConfirm={inviteAll}
      />
    </div>
  );
}
