"use client";
import { useState } from "react";
import { DoorOpen, ExternalLink, Hourglass, Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { adminApi } from "@/lib/client/admin-api";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Empty, Pill, Table, ago } from "./ui";

type Counts = { waiting: number; invited: number; total: number; today: number };
type Row = { id: string; email: string; name: string | null; source: string | null; createdAt: string; invitedAt: string | null };
export type WaitlistState = { waitlist: boolean; since: string; counts: Counts; recent: Row[] };

/** The waitlist switch: pause new signups, watch the line grow, invite people in. Mirrors the maintenance switch. */
export function WaitlistToggle({ initial }: { initial: WaitlistState }) {
  const toast = useToast();
  const [st, setSt] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<null | "on" | "off" | "all">(null);
  const [inviteOnOff, setInviteOnOff] = useState(true);

  async function run(key: string, init: { method: "PUT" | "POST"; json: unknown }, msg: (r: WaitlistState & { invited: number }) => string) {
    setBusy(key);
    try {
      const r = await adminApi<WaitlistState & { invited: number }>("/api/admin/waitlist", init);
      setSt({ waitlist: r.waitlist, since: r.since, counts: r.counts, recent: r.recent });
      toast(msg(r));
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
  const invite = (ids?: string[]) =>
    run(ids ? `one:${ids[0]}` : "all", { method: "POST", json: ids ? { ids } : {} }, (r) => (r.invited ? `${r.invited} invite${r.invited === 1 ? "" : "s"} emailed` : "Nobody to invite"));

  const on = st.waitlist;
  const c = st.counts;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card>
        <CardTitle hint={on && st.since ? `On since ${new Date(st.since).toLocaleString()}` : "Anyone can create an account."} action={<Pill tone={on ? "info" : "ok"}>{on ? "Waitlist ON" : "Signups open"}</Pill>}>
          Waitlist switch
        </CardTitle>
        <div className={cn("flex flex-wrap items-center justify-between gap-4 rounded-[20px] p-4 hairline", on ? "bg-accent/10" : "bg-secondary/40")}>
          <div className="flex items-center gap-3">
            <span className={cn("grid h-11 w-11 place-items-center rounded-2xl", on ? "bg-accent/15 text-foreground" : "bg-success/15 text-success")}>
              {on ? <Hourglass className="h-5 w-5" aria-hidden /> : <DoorOpen className="h-5 w-5" aria-hidden />}
            </span>
            <div>
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
            className={cn("relative inline-flex h-9 w-16 shrink-0 items-center rounded-full transition-colors duration-300 disabled:opacity-60", on ? "bg-foreground" : "bg-foreground/20")}
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
        <CardTitle hint="People who left their email on the waitlist page.">The line</CardTitle>
        <dl className="grid grid-cols-3 gap-3">
          {[
            ["Waiting", c.waiting],
            ["Invited", c.invited],
            ["Last 24 h", c.today],
          ].map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-secondary/50 p-3">
              <dt className="text-[12px] font-semibold text-muted-foreground">{k}</dt>
              <dd className="mt-1 font-display text-[1.9rem] font-bold leading-none tabular">{v}</dd>
            </div>
          ))}
        </dl>
        <Button type="button" variant="primary" className="mt-4 w-full" disabled={!!busy || c.waiting === 0} onClick={() => setAsk("all")}>
          <Send className="h-4 w-4" aria-hidden /> Invite everyone waiting ({c.waiting})
        </Button>
        <p className="mt-4 flex items-start gap-2 text-[13px] leading-relaxed text-muted-foreground">
          <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Invites go through your email provider (Integrations). With Mock email they land in the Outbox. An invited email can sign up even while the waitlist stays on.
        </p>
      </Card>

      <Card className="lg:col-span-2">
        <CardTitle hint={`Newest first. ${c.total} joined in total.`}>People on the list</CardTitle>
        {st.recent.length === 0 ? (
          <Empty title="Nobody in line yet" body="When the waitlist is on, every signup button leads to the waitlist page. New entries show up here." />
        ) : (
          <Table head={["Email", "Name", "Joined", "Status", <span key="a" className="sr-only">Action</span>]}>
            {st.recent.map((r) => (
              <tr key={r.id}>
                <td className="max-w-[260px] truncate font-medium">{r.email}</td>
                <td className="text-muted-foreground">{r.name || "-"}</td>
                <td className="whitespace-nowrap text-muted-foreground">{ago(r.createdAt)}</td>
                <td>{r.invitedAt ? <Pill tone="ok">Invited {ago(r.invitedAt)}</Pill> : <Pill tone="muted">Waiting</Pill>}</td>
                <td className="text-right">
                  {!r.invitedAt && (
                    <Button type="button" size="sm" variant="subtle" disabled={!!busy} onClick={() => invite([r.id])} aria-label={`Invite ${r.email}`}>
                      {busy === `one:${r.id}` ? "Sending…" : "Invite"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={ask === "on"}
        onOpenChange={(o) => !o && setAsk(null)}
        title="Pause new signups?"
        body="Visitors will see the waitlist page instead of signup, and new accounts are refused until you switch it back. Existing users sign in as normal."
        confirmLabel="Turn the waitlist on"
        tone="primary"
        busy={busy === "switch"}
        onConfirm={() => turn(true)}
      />
      <ConfirmDialog
        open={ask === "off"}
        onOpenChange={(o) => !o && setAsk(null)}
        title="Open signups again?"
        body={inviteOnOff && c.waiting ? `Anyone can create an account again, and ${c.waiting} ${c.waiting === 1 ? "person gets" : "people get"} an invite email now.` : "Anyone can create an account again. Nobody is emailed."}
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
        onConfirm={() => invite()}
      />
    </div>
  );
}
