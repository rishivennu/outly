"use client";
import { useState } from "react";
import { Copy, FlaskConical, Gift, KeyRound, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { adminApi } from "@/lib/client/admin-api";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Empty, Pill, Table, ago } from "./ui";
import type { BetaState } from "@/lib/beta";

type R = BetaState & { made?: string | null; given?: number };

/** Beta switch, first-members offer and the list of codes. */
export function BetaPanel({ initial }: { initial: BetaState }) {
  const toast = useToast();
  const [st, setSt] = useState<BetaState>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<null | "off" | "backfill">(null);
  const [limit, setLimit] = useState(String(initial.config.limit));
  const [months, setMonths] = useState(String(initial.config.months));
  const [planSlug, setPlanSlug] = useState(initial.config.planSlug);
  const [note, setNote] = useState("");
  const [made, setMade] = useState<string | null>(null);

  async function run(key: string, init: { method: "PUT" | "POST"; json: unknown }, msg?: (r: R) => string) {
    setBusy(key);
    try {
      const r = await adminApi<R>("/api/admin/beta", init);
      setSt(r);
      if (r.made) setMade(r.made);
      if (msg) toast(msg(r));
      return r;
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
      setAsk(null);
    }
  }

  const on = st.config.enabled;
  const c = st.counts;
  const n = Math.max(0, Math.min(100_000, Math.floor(Number(limit) || 0)));
  const m = Math.max(1, Math.min(24, Math.floor(Number(months) || 3)));
  const dirty = n !== st.config.limit || m !== st.config.months || planSlug !== st.config.planSlug;
  const planName = st.plans.find((p) => p.slug === st.config.planSlug)?.name ?? st.config.planSlug;

  const turn = (v: boolean) => run("switch", { method: "PUT", json: { enabled: v } }, () => (v ? "Beta is ON. The site says beta again." : "Beta is OFF. Beta wording is gone from the site."));
  const saveOffer = () => run("offer", { method: "PUT", json: { limit: n, months: m, planSlug } }, () => (n ? `Saved. The first ${n} members get ${m} months free.` : "Saved. No new codes go out (limit is 0)."));

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast(`Copied ${code}`);
    } catch {
      toast("Couldn't copy. Select the code and copy it by hand.", "error");
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Card>
        <CardTitle hint="Hero stamp, “Free during beta”, footer note, pricing and contact copy." action={<Pill tone={on ? "info" : "muted"}>{on ? "Beta ON" : "Beta OFF"}</Pill>}>
          Beta switch
        </CardTitle>
        <div className={cn("flex flex-wrap items-center justify-between gap-4 rounded-[20px] p-4 hairline", on ? "bg-accent/10" : "bg-secondary/40")}>
          <div className="flex items-center gap-3">
            <span className={cn("grid h-11 w-11 place-items-center rounded-2xl", on ? "bg-accent/15 text-foreground" : "bg-secondary text-muted-foreground")}>
              <FlaskConical className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="font-display text-[15px] font-semibold">{on ? "The site says Outlly is in beta" : "No beta wording anywhere"}</p>
              <p className="text-[12.5px] text-muted-foreground">{on ? "New members can still get first-member codes while this is on." : "Turn on to show the beta stamp and hand out first-member codes."}</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Beta mode"
            disabled={!!busy}
            onClick={() => (on ? setAsk("off") : turn(true))}
            className={cn("relative inline-flex h-9 w-16 shrink-0 items-center rounded-full transition-colors duration-300 disabled:opacity-60", on ? "bg-success" : "bg-foreground/20")}
          >
            <span className={cn("inline-block h-7 w-7 rounded-full bg-white shadow transition-transform duration-300", on ? "translate-x-8" : "translate-x-1")} />
          </button>
        </div>
      </Card>

      <Card>
        <CardTitle hint="Codes handed to members. Revoking an unused one frees its seat.">Seats</CardTitle>
        <dl className="grid grid-cols-3 gap-3">
          {[
            ["Given", c.issued],
            ["Redeemed", c.redeemed],
            ["Seats left", c.left],
          ].map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-secondary/50 p-3">
              <dt className="text-[12px] font-semibold text-muted-foreground">{k}</dt>
              <dd className="mt-1 font-display text-[1.9rem] font-bold leading-none tabular">{v}</dd>
            </div>
          ))}
        </dl>
        <Button type="button" variant="subtle" className="mt-4 w-full" disabled={!!busy || !on || c.left === 0} title={on ? undefined : "Turn beta on to hand out codes"} onClick={() => setAsk("backfill")}>
          <Users className="h-4 w-4" aria-hidden /> Give codes to existing members, oldest first
        </Button>
      </Card>

      <Card className="lg:col-span-2">
        <CardTitle hint="Each code works once, only on the account it was emailed to. It switches the plan on for free, and nothing renews.">First-members offer</CardTitle>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="beta-limit">How many members get a code</Label>
            <Input id="beta-limit" type="number" inputMode="numeric" min={0} max={100000} value={limit} onChange={(e) => setLimit(e.target.value)} aria-describedby="beta-limit-hint" />
            <p id="beta-limit-hint" className="mt-1 text-[12px] text-muted-foreground">The first {n || "0"} to join. 0 = no codes.</p>
          </div>
          <div>
            <Label htmlFor="beta-plan">Plan</Label>
            <select id="beta-plan" value={planSlug} onChange={(e) => setPlanSlug(e.target.value)} className="h-11 w-full rounded-2xl bg-secondary/50 px-3 text-[14px] hairline">
              {st.plans.map((p) => (
                <option key={p.slug} value={p.slug}>{p.name}</option>
              ))}
              {!st.plans.some((p) => p.slug === planSlug) && <option value={planSlug}>{planSlug}</option>}
            </select>
          </div>
          <div>
            <Label htmlFor="beta-months">Free months</Label>
            <Input id="beta-months" type="number" inputMode="numeric" min={1} max={24} value={months} onChange={(e) => setMonths(e.target.value)} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="button" variant="primary" disabled={!!busy || !dirty} onClick={saveOffer}>
            {busy === "offer" ? "Saving…" : "Save offer"}
          </Button>
          <p className="text-[13px] text-muted-foreground">
            Now: first {st.config.limit} members get {st.config.months} months of {planName}{on ? "" : " (paused while beta is off)"}.
          </p>
        </div>

        <div className="mt-6 rounded-[20px] bg-secondary/40 p-4 hairline">
          <p className="flex items-center gap-2 font-display text-[15px] font-semibold"><Gift className="h-4 w-4" aria-hidden /> Make a code by hand</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">For a partner or a giveaway. Works for any account, once, and doesn't use a seat.</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-[14rem] flex-1">
              <Label htmlFor="beta-note">Who it's for (optional)</Label>
              <Input id="beta-note" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Priya, creator meetup" />
            </div>
            <Button type="button" variant="subtle" disabled={!!busy || !on} title={on ? undefined : "Turn beta on to make codes"} onClick={() => run("manual", { method: "POST", json: { action: "manual", note } }, () => "Code made").then(() => setNote(""))}>
              <KeyRound className="h-4 w-4" aria-hidden /> {busy === "manual" ? "Making…" : "Make code"}
            </Button>
          </div>
          {made && (
            <div className="mt-3 flex flex-wrap items-center gap-2" role="status">
              <code className="rounded-xl bg-background px-3 py-2 font-mono text-[15px] font-semibold tracking-wider hairline">{made}</code>
              <Button type="button" size="sm" variant="ghost" onClick={() => copy(made)}><Copy className="h-4 w-4" aria-hidden /> Copy</Button>
            </div>
          )}
        </div>
      </Card>

      <Card className="lg:col-span-2">
        <CardTitle hint="Newest first, last 100.">Codes</CardTitle>
        {st.codes.length === 0 ? (
          <Empty title="No codes yet" body="Set how many members get one and save. Codes are made and emailed as people sign up." />
        ) : (
          <Table label="Beta codes" head={["Code", "For", "Plan", "Made", "Status", <span key="a" className="sr-only">Action</span>]}>
            {st.codes.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap font-mono text-[13px] font-semibold">
                  <button type="button" onClick={() => copy(r.code)} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-1 hover:bg-secondary" aria-label={`Copy code ${r.code}`}>
                    {r.code} <Copy className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  </button>
                </td>
                <td className="max-w-[260px] truncate text-muted-foreground">{r.issuedTo ?? (r.note || "Anyone")}</td>
                <td className="whitespace-nowrap text-muted-foreground">{st.plans.find((p) => p.slug === r.planSlug)?.name ?? r.planSlug} · {r.months} mo</td>
                <td className="whitespace-nowrap text-muted-foreground">{ago(r.createdAt)}</td>
                <td>
                  {r.revokedAt ? <Pill tone="muted">Revoked</Pill> : r.redeemedAt ? <Pill tone="ok">Redeemed {ago(r.redeemedAt)}</Pill> : <Pill tone="info">Unused</Pill>}
                </td>
                <td className="text-right">
                  {!r.redeemedAt && !r.revokedAt && (
                    <Button type="button" size="sm" variant="ghost" disabled={!!busy} onClick={() => run(`rv:${r.id}`, { method: "POST", json: { action: "revoke", id: r.id } }, () => `Revoked ${r.code}`)} aria-label={`Revoke ${r.code}`}>
                      {busy === `rv:${r.id}` ? "Revoking…" : "Revoke"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={ask === "off"}
        onOpenChange={(o) => !o && setAsk(null)}
        title="Turn beta off?"
        body="Every beta mention disappears from the site on the next page load, and new members stop getting codes. Codes already sent keep working."
        confirmLabel="Turn beta off"
        tone="primary"
        busy={busy === "switch"}
        onConfirm={() => turn(false)}
      />
      <ConfirmDialog
        open={ask === "backfill"}
        onOpenChange={(o) => !o && setAsk(null)}
        title={`Email codes to up to ${c.left} existing ${c.left === 1 ? "member" : "members"}?`}
        body="The earliest members without a code each get one by email, until the seats run out."
        confirmLabel="Send codes"
        tone="primary"
        busy={busy === "backfill"}
        onConfirm={() => run("backfill", { method: "POST", json: { action: "backfill" } }, (r) => (r.given ? `${r.given} code${r.given === 1 ? "" : "s"} emailed` : "Everyone early already has one"))}
      />
    </div>
  );
}
