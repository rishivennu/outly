"use client";
import { useState } from "react";
import { Flag, Gift, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { adminApi } from "@/lib/client/admin-api";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Empty, Pill, Table, ago, fmtDate, type Tone } from "./ui";

type Config = { enabled: boolean; rewardPlan: string; rewardDays: number; eligiblePlans: string[] };
type Totals = { invited: number; registered: number; paid: number; rewarded: number; disqualified: number; flagged: number };
type Row = {
  id: string; code: string; status: string; label: string;
  referrer: { id: string; name: string; email: string };
  referred: { id: string; name: string; email: string; verified: boolean; joined: string } | null;
  flags: string[]; sameNetwork: number; paymentId: string | null; paidAt: string | null; registeredAt: string | null;
  disqualifiedReason: string | null;
  grant: { id: string; status: string; plan: string; startsAt: string; endsAt: string } | null;
  createdAt: string;
};
type PlanOpt = { slug: string; name: string };

const LABEL_TONE: Record<string, Tone> = {
  Invited: "muted", Registered: "info", "Awaiting qualifying payment": "warn", "Payment verified": "info",
  "Reward granted": "ok", "Reward expired": "muted", "Referral disqualified": "bad",
};
const FLAG_LABEL: Record<string, string> = { burst: "Many sign-ups in a short time", "shared-network": "Same network as other referrals", self: "Self-referral", "same-inbox": "Same inbox as referrer" };

/** Admin: Refer & Earn settings, totals, and an investigation list with disqualify. */
export function ReferralsPanel({ initial, plans }: { initial: { rows: Row[]; totals: Totals; config: Config }; plans: PlanOpt[] }) {
  const toast = useToast();
  const [rows, setRows] = useState(initial.rows);
  const [totals, setTotals] = useState(initial.totals);
  const [cfg, setCfg] = useState(initial.config);
  const [draft, setDraft] = useState(initial.config);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [flagged, setFlagged] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const name = (slug: string) => plans.find((p) => p.slug === slug)?.name ?? slug;
  const dirty = JSON.stringify(draft) !== JSON.stringify(cfg);

  async function load(next: { search?: string; status?: string; flagged?: boolean } = {}) {
    const s = { search, status, flagged, ...next };
    setBusy("load");
    try {
      const p = new URLSearchParams();
      if (s.search.trim()) p.set("search", s.search.trim());
      if (s.status) p.set("status", s.status);
      if (s.flagged) p.set("flagged", "1");
      const r = await adminApi<{ rows: Row[]; totals: Totals; config: Config }>(`/api/admin/referrals?${p}`);
      setRows(r.rows);
      setTotals(r.totals);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      const r = await adminApi<{ config: Config }>("/api/admin/referrals", { method: "PUT", json: draft });
      setCfg(r.config);
      setDraft(r.config);
      toast("Saved. New rewards use these terms; earned ones stay as they are.");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function disqualify() {
    if (!ask) return;
    if (reason.trim().length < 3) return toast("Say why, for the audit trail.", "error");
    setBusy("dq");
    try {
      await adminApi("/api/admin/referrals", { method: "POST", json: { action: "revoke", id: ask.id, reason } });
      toast("Referral disqualified. Any reward it gave has ended.");
      setAsk(null);
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const toggleEligible = (slug: string) =>
    setDraft((d) => ({ ...d, eligiblePlans: d.eligiblePlans.includes(slug) ? d.eligiblePlans.filter((x) => x !== slug) : [...d.eligiblePlans, slug] }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Card>
        <CardTitle hint="Rows by stage. Flagged = worth a look before trusting." action={<Pill tone={cfg.enabled ? "ok" : "muted"}>{cfg.enabled ? "On" : "Paused"}</Pill>}>Totals</CardTitle>
        <dl className="grid grid-cols-3 gap-3">
          {([
            ["Opened", totals.invited], ["Registered", totals.registered], ["Paid", totals.paid],
            ["Rewarded", totals.rewarded], ["Disqualified", totals.disqualified], ["Flagged", totals.flagged],
          ] as const).map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-secondary/50 p-3">
              <dt className="text-[12px] font-semibold text-muted-foreground">{k}</dt>
              <dd className="mt-1 font-display text-[1.6rem] font-bold leading-none tabular">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card>
        <CardTitle hint="The referred friend gets the reward after their first verified payment on an eligible plan. It starts when their paid period ends.">
          <span className="inline-flex items-center gap-2"><Gift className="h-4 w-4" aria-hidden /> Reward terms</span>
        </CardTitle>
        <div className="grid gap-4">
          <label className="flex min-h-[44px] items-center justify-between gap-3 rounded-[20px] bg-secondary/40 px-4 hairline">
            <span className="text-[14px] font-medium">Refer &amp; Earn is on</span>
            <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} className="h-5 w-5 accent-lime" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="rf-plan">Reward plan</Label>
              <select id="rf-plan" value={draft.rewardPlan} onChange={(e) => setDraft({ ...draft, rewardPlan: e.target.value })} className="h-11 w-full rounded-2xl bg-secondary/50 px-3 text-[14px] hairline">
                {plans.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="rf-days">Reward length (days)</Label>
              <Input id="rf-days" type="number" min={1} max={365} value={draft.rewardDays} onChange={(e) => setDraft({ ...draft, rewardDays: Math.max(1, Math.min(365, Math.floor(Number(e.target.value) || 1))) })} />
            </div>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium">Payments that qualify</legend>
            <div className="flex flex-wrap gap-2">
              {plans.map((p) => {
                const on = draft.eligiblePlans.includes(p.slug);
                return (
                  <button key={p.slug} type="button" role="checkbox" aria-checked={on} onClick={() => toggleEligible(p.slug)} className={cn("h-11 rounded-2xl px-4 text-[13.5px] hairline", on ? "bg-lime/20 font-semibold text-lime-ink" : "bg-secondary/40 text-muted-foreground")}>
                    {p.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="primary" disabled={!dirty || !!busy || draft.eligiblePlans.length === 0} onClick={save}>{busy === "save" ? "Saving…" : "Save terms"}</Button>
            <p className="text-[13px] text-muted-foreground">Now: {cfg.rewardDays} days of {name(cfg.rewardPlan)} after a first payment on {cfg.eligiblePlans.map(name).join(", ") || "nothing"}.</p>
          </div>
        </div>
      </Card>

      <Card className="lg:col-span-2">
        <CardTitle hint="Search by email or referral code. Flags are signals, not proof: check before you disqualify.">Referrals</CardTitle>
        <form className="mb-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void load(); }}>
          <div className="min-w-[14rem] flex-1">
            <Label htmlFor="rf-q">Email or code</Label>
            <Input id="rf-q" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="name@example.com or ab12cd" />
          </div>
          <div>
            <Label htmlFor="rf-st">Stage</Label>
            <select id="rf-st" value={status} onChange={(e) => { setStatus(e.target.value); void load({ status: e.target.value }); }} className="h-11 rounded-2xl bg-secondary/50 px-3 text-[14px] hairline">
              <option value="">All but opened-only</option>
              <option value="invited">Opened only</option>
              <option value="registered">Registered</option>
              <option value="paid">Paid</option>
              <option value="rewarded">Rewarded</option>
              <option value="disqualified">Disqualified</option>
            </select>
          </div>
          <button type="button" aria-pressed={flagged} onClick={() => { setFlagged(!flagged); void load({ flagged: !flagged }); }} className={cn("inline-flex h-11 items-center gap-1.5 rounded-2xl px-4 text-[13.5px] hairline", flagged ? "bg-warning/15 font-semibold" : "bg-secondary/40")}>
            <Flag className="h-4 w-4" aria-hidden /> Flagged only
          </button>
          <Button type="submit" variant="subtle" disabled={busy === "load"}><Search className="h-4 w-4" aria-hidden /> Search</Button>
        </form>
        {rows.length === 0 ? (
          <Empty title="Nothing here" body="No referrals match. Try another search or stage." />
        ) : (
          <Table label="Referrals" head={["Referrer", "Friend", "Stage", "Signals", "Reward", "Updated", <span key="a" className="sr-only">Action</span>]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="max-w-[200px]">
                  <p className="truncate font-medium">{r.referrer.name}</p>
                  <p className="truncate text-[12px] text-muted-foreground">{r.referrer.email} · {r.code}</p>
                </td>
                <td className="max-w-[200px]">
                  {r.referred ? (
                    <>
                      <p className="truncate font-medium">{r.referred.name}</p>
                      <p className="truncate text-[12px] text-muted-foreground">{r.referred.email}{r.referred.verified ? "" : " · not verified"}</p>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Opened the link</span>
                  )}
                </td>
                <td>
                  <Pill tone={LABEL_TONE[r.label] ?? "muted"}>{r.label}</Pill>
                  {r.disqualifiedReason && <p className="mt-1 max-w-[200px] text-[12px] text-muted-foreground">{r.disqualifiedReason}</p>}
                </td>
                <td className="max-w-[200px] text-[12px] text-muted-foreground">
                  {r.flags.length === 0 && r.sameNetwork === 0 ? "None" : (
                    <ul className="space-y-0.5">
                      {r.flags.map((f) => <li key={f}>{FLAG_LABEL[f] ?? f}</li>)}
                      {r.sameNetwork > 0 && <li>{r.sameNetwork} more on this network</li>}
                    </ul>
                  )}
                </td>
                <td className="whitespace-nowrap text-[12.5px] text-muted-foreground">
                  {r.grant ? `${r.grant.plan}, ${fmtDate(r.grant.startsAt)} to ${fmtDate(r.grant.endsAt)}` : r.paidAt ? `Paid ${fmtDate(r.paidAt)}` : "None yet"}
                </td>
                <td className="whitespace-nowrap text-muted-foreground">{ago(r.registeredAt ?? r.createdAt)}</td>
                <td className="text-right">
                  {r.status !== "disqualified" && (
                    <Button type="button" size="sm" variant="ghost" disabled={!!busy} onClick={() => { setAsk(r); setReason(""); }} aria-label={`Disqualify referral of ${r.referred?.email ?? "visitor"}`}>
                      Disqualify
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={!!ask}
        onOpenChange={(o) => !o && setAsk(null)}
        title="Disqualify this referral?"
        body={ask?.grant ? "The free time it gave ends now. Their paid plan, if any, is not touched. This is logged with your reason." : "It will never earn a reward. This is logged with your reason."}
        confirmLabel="Disqualify"
        busy={busy === "dq"}
        extra={
          <div className="mt-3">
            <Label htmlFor="rf-reason">Reason</Label>
            <Input id="rf-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. same person, two inboxes" />
          </div>
        }
        onConfirm={() => void disqualify()}
      />
    </div>
  );
}
