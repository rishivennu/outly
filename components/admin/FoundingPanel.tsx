"use client";
import { useState } from "react";
import Image from "next/image";
import { MailCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { adminApi } from "@/lib/client/admin-api";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Empty, Pill, Table, ago } from "./ui";
import type { FoundingState } from "@/lib/founding";

type R = FoundingState & { claimed?: number; invited?: number };

/** Founding program: switch, seat count, lifetime discount, Gmail rule and the numbered members. */
export function FoundingPanel({ initial }: { initial: FoundingState }) {
  const toast = useToast();
  const [st, setSt] = useState<FoundingState>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<null | "off" | "backfill" | { id: string; label: string }>(null);
  const [limit, setLimit] = useState(String(initial.config.limit));
  const [pct, setPct] = useState(String(initial.config.discountPct));

  async function run(key: string, init: { method: "PUT" | "POST"; json: unknown }, msg?: (r: R) => string) {
    setBusy(key);
    try {
      const r = await adminApi<R>("/api/admin/founding", init);
      setSt(r);
      if (msg) toast(msg(r));
      return r;
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
      setAsk(null);
    }
  }

  const cfg = st.config;
  const on = cfg.enabled;
  const c = st.counts;
  const n = Math.max(0, Math.min(100_000, Math.floor(Number(limit) || 0)));
  const d = Math.max(1, Math.min(90, Math.floor(Number(pct) || 30)));
  const dirty = n !== cfg.limit || d !== cfg.discountPct;
  const turn = (v: boolean) => run("switch", { method: "PUT", json: { enabled: v } }, () => (v ? "Founding seats are open. Signup shows how many are left." : "Founding seats are closed. Members keep their discount."));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Card>
        <CardTitle hint="Signup page seat counter, the claim email, the stamp on Home and Billing." action={<Pill tone={on ? "info" : "muted"}>{on ? "Open" : "Closed"}</Pill>}>
          Founding seats
        </CardTitle>
        <div className={cn("flex flex-wrap items-center justify-between gap-4 rounded-[20px] p-4 hairline", on ? "bg-accent/10" : "bg-secondary/40")}>
          <div className="flex items-center gap-3">
            <Image src="/brand/founding/01-rocket-badge.png" alt="" width={48} height={48} className="h-12 w-12 shrink-0" />
            <div>
              <p className="font-display text-[15px] font-semibold">{on ? `${c.left} of ${cfg.limit} seats left` : "No new founding members"}</p>
              <p className="text-[12.5px] text-muted-foreground">{on ? "Seats go to confirmed inboxes, in the order they claim." : "Turn on to show the counter on signup and start numbering members."}</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Founding seats open"
            disabled={!!busy}
            onClick={() => (on ? setAsk("off") : turn(true))}
            className={cn("relative inline-flex h-9 w-16 shrink-0 items-center rounded-full transition-colors duration-300 disabled:opacity-60", on ? "bg-success" : "bg-foreground/20")}
          >
            <span className={cn("inline-block h-7 w-7 rounded-full bg-white shadow transition-transform duration-300", on ? "translate-x-8" : "translate-x-1")} />
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-[20px] bg-secondary/40 p-4 hairline">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-secondary" aria-hidden><MailCheck className="h-5 w-5" /></span>
            <div>
              <p className="font-display text-[15px] font-semibold">{cfg.gmailOnly ? "Gmail addresses only" : "Any confirmed address"}</p>
              <p className="text-[12.5px] text-muted-foreground">Dots and +tags in a Gmail address count as the same inbox, so one person gets one seat.</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={cfg.gmailOnly}
            aria-label="Gmail addresses only"
            disabled={!!busy}
            onClick={() => run("gmail", { method: "PUT", json: { gmailOnly: !cfg.gmailOnly } }, (r) => (r.config.gmailOnly ? "Only Gmail inboxes can claim a seat." : "Any confirmed inbox can claim a seat."))}
            className={cn("relative inline-flex h-9 w-16 shrink-0 items-center rounded-full transition-colors duration-300 disabled:opacity-60", cfg.gmailOnly ? "bg-success" : "bg-foreground/20")}
          >
            <span className={cn("inline-block h-7 w-7 rounded-full bg-white shadow transition-transform duration-300", cfg.gmailOnly ? "translate-x-8" : "translate-x-1")} />
          </button>
        </div>
      </Card>

      <Card>
        <CardTitle hint="A seat needs a confirmed inbox: Google sign-in, an emailed code, or the claim link.">Seats</CardTitle>
        <dl className="grid grid-cols-3 gap-3">
          {[
            ["Taken", c.used],
            ["Left", c.left],
            ["Not confirmed", c.waiting],
          ].map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-secondary/50 p-3">
              <dt className="text-[12px] font-semibold text-muted-foreground">{k}</dt>
              <dd className="mt-1 font-display text-[1.9rem] font-bold leading-none tabular">{v}</dd>
            </div>
          ))}
        </dl>
        <Button type="button" variant="subtle" className="mt-4 w-full" disabled={!!busy || !on || c.left === 0} title={on ? undefined : "Open founding seats first"} onClick={() => setAsk("backfill")}>
          <Users className="h-4 w-4" aria-hidden /> Offer seats to existing members, oldest first
        </Button>
      </Card>

      <Card className="lg:col-span-2">
        <CardTitle hint="A member keeps the discount they claimed with, even if you change it later.">Offer</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="f-limit">Number of founding seats</Label>
            <Input id="f-limit" type="number" inputMode="numeric" min={0} max={100000} value={limit} onChange={(e) => setLimit(e.target.value)} aria-describedby="f-limit-hint" />
            <p id="f-limit-hint" className="mt-1 text-[12px] text-muted-foreground">{n < c.used ? `Below the ${c.used} already taken: nobody loses a seat, new claims just stop.` : `Signup will show ${Math.max(0, n - c.used)} of ${n} left.`}</p>
          </div>
          <div>
            <Label htmlFor="f-pct">Lifetime discount (%)</Label>
            <Input id="f-pct" type="number" inputMode="numeric" min={1} max={90} value={pct} onChange={(e) => setPct(e.target.value)} />
            <p className="mt-1 text-[12px] text-muted-foreground">Off every paid plan, monthly and yearly, applied at checkout.</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="button" variant="primary" disabled={!!busy || !dirty} onClick={() => run("offer", { method: "PUT", json: { limit: n, discountPct: d } }, (r) => `Saved. ${r.config.limit} seats, ${r.config.discountPct}% off for life.`)}>
            {busy === "offer" ? "Saving…" : "Save offer"}
          </Button>
          <p className="text-[13px] text-muted-foreground">Now: {cfg.limit} seats at {cfg.discountPct}% off{on ? "" : " (closed)"}.</p>
        </div>
      </Card>

      <Card className="lg:col-span-2">
        <CardTitle hint="In seat order. Revoking takes the discount away and retires the number.">Founding members</CardTitle>
        {st.members.length === 0 ? (
          <Empty title="No founding members yet" body="Open the seats. People who confirm their inbox are numbered as they claim." />
        ) : (
          <Table label="Founding members" head={["No.", "Member", "Discount", "Joined", <span key="a" className="sr-only">Action</span>]}>
            {st.members.map((m) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap font-display text-[15px] font-bold tabular">#{m.no}</td>
                <td className="max-w-[320px] truncate">{m.name ? `${m.name} (${m.email})` : m.email}</td>
                <td className="whitespace-nowrap text-muted-foreground">{m.pct}% for life</td>
                <td className="whitespace-nowrap text-muted-foreground">{ago(m.at)}</td>
                <td className="text-right">
                  <Button type="button" size="sm" variant="ghost" disabled={!!busy} onClick={() => setAsk({ id: m.id, label: `#${m.no} ${m.email}` })} aria-label={`Revoke founding seat #${m.no}`}>
                    Revoke
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={ask === "off"}
        onOpenChange={(o) => !o && setAsk(null)}
        title="Close founding seats?"
        body="The counter leaves the signup page and nobody new can claim. Existing members keep their number and their discount."
        confirmLabel="Close seats"
        tone="primary"
        busy={busy === "switch"}
        onConfirm={() => turn(false)}
      />
      <ConfirmDialog
        open={ask === "backfill"}
        onOpenChange={(o) => !o && setAsk(null)}
        title={`Offer up to ${c.left} seat${c.left === 1 ? "" : "s"} to existing members?`}
        body="Oldest first. Members whose inbox is already confirmed get a seat and the welcome email now. Everyone else gets the claim link, and the seat goes to whoever confirms first."
        confirmLabel="Offer seats"
        tone="primary"
        busy={busy === "backfill"}
        onConfirm={() => run("backfill", { method: "POST", json: { action: "backfill" } }, (r) => (r.claimed || r.invited ? `${r.claimed} seated, ${r.invited} sent the claim link` : "Nobody new to offer a seat to"))}
      />
      <ConfirmDialog
        open={typeof ask === "object" && ask !== null}
        onOpenChange={(o) => !o && setAsk(null)}
        title="Revoke this founding seat?"
        body={`${typeof ask === "object" && ask ? ask.label : ""} loses the founding discount on future payments. Plans already paid for are not touched.`}
        confirmLabel="Revoke seat"
        tone="danger"
        busy={!!busy?.startsWith("rv:")}
        onConfirm={() => typeof ask === "object" && ask && run(`rv:${ask.id}`, { method: "POST", json: { action: "revoke", id: ask.id } }, () => "Seat revoked")}
      />
    </div>
  );
}
