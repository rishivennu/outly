"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/shared/Sheet";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { SwitchRow } from "@/components/admin/Switch";
import { Card, CardTitle, Empty, Pill, Table, fmtDate, type Tone } from "@/components/admin/ui";
import { adminApi } from "@/lib/client/admin-api";
import { CATEGORY_LABEL, COST_CATEGORIES, CURRENCIES, FEATURE_LABEL, PROVIDERS, fmtInr, fmtMoney, providerLabel, type CostCategoryId } from "@/lib/costs/core";
import type { AlertView, BillView, BudgetView, PriceView, RecurringView } from "@/lib/costs/overview";
import type { ImportPreview } from "@/lib/costs/import";
import type { ConnectionView } from "@/lib/costs/connections";

/**
 * R1314 Phase 1, the manual side of Infrastructure & Costs: recurring subscriptions, bills, budgets, unit prices and
 * alerts. Each list has one Sheet form; saves go through /api/admin/costs/<kind> and the server page re-renders.
 */
const SELECT = "h-12 w-full cursor-pointer appearance-none rounded-2xl bg-secondary/60 px-4 text-base text-foreground field-edge focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))]";
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const today = () => new Date().toISOString().slice(0, 10);
const major = (minor: number) => (minor / 100).toString();
const minorOf = (major: string) => Math.round((Number(major) || 0) * 100);

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="mt-1.5 text-[12.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
function Select({ id, value, onChange, children }: { id: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={SELECT}>{children}</select>;
}
const ProviderOptions = () => <>{PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</>;
const CategoryOptions = () => <>{COST_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</>;
const CurrencyOptions = () => <>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</>;

function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<unknown>, done?: () => void) => {
    setBusy(true); setError("");
    try { await fn(); router.refresh(); done?.(); } catch (e: any) { setError(e.message || "That didn't save."); } finally { setBusy(false); }
  };
  return { busy, error, run };
}

function Err({ text }: { text: string }) {
  return text ? <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-[13px] text-[hsl(0_72%_38%)] dark:text-destructive">{text}</p> : null;
}

function Remove({ kind, id, name, onDone }: { kind: string; id: string; name: string; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const { busy, run } = useSave();
  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>Remove</Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title={`Remove ${name}?`} body="It leaves this list. Anything already booked in the ledger stays, because it was paid." confirmLabel="Remove" busy={busy} onConfirm={() => run(() => adminApi(`/api/admin/costs/${kind}/${id}`, { method: "DELETE" }), () => { setOpen(false); onDone?.(); })} />
    </>
  );
}

/* ---------- Recurring expenses ---------- */
type RecurringDraft = { name: string; provider: string; category: string; amount: string; currency: string; cadence: string; startsAt: string; nextRenewal: string; endsAt: string; autoRenew: boolean; active: boolean; note: string };
const recurringDraft = (r: RecurringView | null): RecurringDraft => r
  ? { name: r.name, provider: r.provider, category: r.category, amount: major(r.amountMinor), currency: r.currency, cadence: r.cadence, startsAt: day(r.startsAt), nextRenewal: day(r.nextRenewal), endsAt: day(r.endsAt), autoRenew: r.autoRenew, active: r.active, note: r.note }
  : { name: "", provider: "vercel", category: "hosting", amount: "", currency: "USD", cadence: "monthly", startsAt: today(), nextRenewal: today(), endsAt: "", autoRenew: true, active: true, note: "" };

function RecurringForm({ item, onClose }: { item: RecurringView | null; onClose: () => void }) {
  const [f, setF] = useState(() => recurringDraft(item));
  const set = <K extends keyof RecurringDraft>(k: K, v: RecurringDraft[K]) => setF((x) => ({ ...x, [k]: v }));
  const { busy, error, run } = useSave();
  const body = { name: f.name, provider: f.provider, category: f.category, amountMinor: minorOf(f.amount), currency: f.currency, cadence: f.cadence, startsAt: f.startsAt, nextRenewal: f.nextRenewal || f.startsAt, endsAt: f.endsAt || null, autoRenew: f.autoRenew, active: f.active, note: f.note };
  return (
    <form className="grid gap-4 pt-2" noValidate onSubmit={(e) => { e.preventDefault(); run(() => (item ? adminApi(`/api/admin/costs/recurring/${item.id}`, { method: "PATCH", json: body }) : adminApi("/api/admin/costs/recurring", { method: "POST", json: body })), onClose); }}>
      <Field id="rc-name" label="Name"><Input id="rc-name" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Vercel Pro" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="rc-provider" label="Provider"><Select id="rc-provider" value={f.provider} onChange={(v) => set("provider", v)}><ProviderOptions /></Select></Field>
        <Field id="rc-category" label="Category"><Select id="rc-category" value={f.category} onChange={(v) => set("category", v)}><CategoryOptions /></Select></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="rc-amount" label="Amount"><Input id="rc-amount" type="number" inputMode="decimal" min={0} step="0.01" value={f.amount} onChange={(e) => set("amount", e.target.value)} placeholder="20.00" /></Field>
        <Field id="rc-currency" label="Currency"><Select id="rc-currency" value={f.currency} onChange={(v) => set("currency", v)}><CurrencyOptions /></Select></Field>
        <Field id="rc-cadence" label="Billed"><Select id="rc-cadence" value={f.cadence} onChange={(v) => set("cadence", v)}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></Select></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="rc-starts" label="Started"><Input id="rc-starts" type="date" value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} /></Field>
        <Field id="rc-next" label="Next renewal" hint="Booked into the ledger on this day."><Input id="rc-next" type="date" value={f.nextRenewal} onChange={(e) => set("nextRenewal", e.target.value)} /></Field>
        <Field id="rc-ends" label="Ends (optional)"><Input id="rc-ends" type="date" value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} /></Field>
      </div>
      <SwitchRow id="rc-auto" label="Auto-renews" hint="Off: the sweep books one renewal, then marks it inactive." on={f.autoRenew} onChange={(v) => set("autoRenew", v)} />
      {item && <SwitchRow id="rc-active" label="Active" hint="Inactive expenses stay listed but are not booked or counted." on={f.active} onChange={(v) => set("active", v)} />}
      <Field id="rc-note" label="Note"><Textarea id="rc-note" rows={2} maxLength={500} value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
      <Err text={error} />
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant="lime" disabled={busy || !f.name || minorOf(f.amount) <= 0}>{busy ? "Saving…" : item ? "Save" : "Add expense"}</Button></div>
    </form>
  );
}

export function RecurringCard({ items }: { items: RecurringView[] }) {
  const [edit, setEdit] = useState<RecurringView | null | false>(false);
  const monthly = items.filter((r) => r.active).reduce((s, r) => s + r.monthlyInrMinor, 0);
  return (
    <Card>
      <CardTitle hint={`Subscriptions Outlly pays. Active ones add up to ${fmtInr(monthly)} a month at today's FX; each renewal is booked at the FX of that day.`} action={<Button size="sm" variant="lime" onClick={() => setEdit(null)}>Add expense</Button>}>Recurring expenses</CardTitle>
      {items.length === 0 ? <Empty title="No recurring expenses yet" body="Add the hosting plan, the database plan, domains and any tool with a monthly or yearly bill." /> : (
        <Table label="Recurring expenses" head={["Name", "Provider", "Amount", "Per month", "Next renewal", "Status", ""]} lead={1} minWidth={760}>
          {items.map((r) => (
            <tr key={r.id}>
              <td><div className="font-medium">{r.name}</div><div className="text-[12.5px] text-muted-foreground">{CATEGORY_LABEL[r.category as CostCategoryId] ?? r.category}</div></td>
              <td>{providerLabel(r.provider)}</td>
              <td>{fmtMoney(r.amountMinor, r.currency)} <span className="text-muted-foreground">/ {r.cadence === "yearly" ? "yr" : "mo"}</span></td>
              <td>{fmtInr(r.monthlyInrMinor)}</td>
              <td>{fmtDate(r.nextRenewal)}</td>
              <td><Pill tone={r.active ? "ok" : "muted"}>{r.active ? (r.autoRenew ? "Auto-renews" : "Manual renew") : "Inactive"}</Pill></td>
              <td className="text-right whitespace-nowrap"><Button type="button" variant="ghost" size="sm" onClick={() => setEdit(r)}>Edit</Button><Remove kind="recurring" id={r.id} name={r.name} /></td>
            </tr>
          ))}
        </Table>
      )}
      <Sheet open={edit !== false} onOpenChange={(o) => !o && setEdit(false)} title={edit ? "Edit recurring expense" : "New recurring expense"} description="A plan or tool Outlly pays for on a schedule.">
        {edit !== false && <RecurringForm key={edit?.id ?? "new"} item={edit} onClose={() => setEdit(false)} />}
      </Sheet>
    </Card>
  );
}

/* ---------- Bills ---------- */
type BillDraft = { provider: string; invoiceId: string; category: string; periodStart: string; periodEnd: string; amount: string; currency: string; status: string; note: string };
const billDraft = (): BillDraft => ({ provider: "vercel", invoiceId: "", category: "hosting", periodStart: today().slice(0, 8) + "01", periodEnd: today(), amount: "", currency: "USD", status: "paid", note: "" });
const BILL_TONE: Record<string, Tone> = { paid: "ok", due: "warn", disputed: "bad" };

function BillForm({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState(billDraft);
  const set = <K extends keyof BillDraft>(k: K, v: BillDraft[K]) => setF((x) => ({ ...x, [k]: v }));
  const { busy, error, run } = useSave();
  const body = { ...f, amountMinor: minorOf(f.amount), amount: undefined };
  return (
    <form className="grid gap-4 pt-2" noValidate onSubmit={(e) => { e.preventDefault(); run(() => adminApi("/api/admin/costs/bills", { method: "POST", json: body }), onClose); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="bl-provider" label="Provider"><Select id="bl-provider" value={f.provider} onChange={(v) => set("provider", v)}><ProviderOptions /></Select></Field>
        <Field id="bl-invoice" label="Invoice number" hint="The same provider + number is never recorded twice."><Input id="bl-invoice" value={f.invoiceId} onChange={(e) => set("invoiceId", e.target.value)} placeholder="INV-2026-11" spellCheck={false} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="bl-amount" label="Amount"><Input id="bl-amount" type="number" inputMode="decimal" min={0} step="0.01" value={f.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
        <Field id="bl-currency" label="Currency"><Select id="bl-currency" value={f.currency} onChange={(v) => set("currency", v)}><CurrencyOptions /></Select></Field>
        <Field id="bl-category" label="Category"><Select id="bl-category" value={f.category} onChange={(v) => set("category", v)}><CategoryOptions /></Select></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="bl-start" label="Period start"><Input id="bl-start" type="date" value={f.periodStart} onChange={(e) => set("periodStart", e.target.value)} /></Field>
        <Field id="bl-end" label="Period end" hint="Booked in the ledger on this day."><Input id="bl-end" type="date" value={f.periodEnd} onChange={(e) => set("periodEnd", e.target.value)} /></Field>
        <Field id="bl-status" label="Status"><Select id="bl-status" value={f.status} onChange={(v) => set("status", v)}><option value="paid">Paid</option><option value="due">Due</option><option value="disputed">Disputed</option></Select></Field>
      </div>
      <Field id="bl-note" label="Note"><Textarea id="bl-note" rows={2} maxLength={500} value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
      <Err text={error} />
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant="lime" disabled={busy || !f.invoiceId || minorOf(f.amount) <= 0}>{busy ? "Saving…" : "Record bill"}</Button></div>
    </form>
  );
}

export function BillsCard({ items }: { items: BillView[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardTitle hint="Actual invoices, in their own currency with the FX of the day they were recorded. Amounts are fixed once booked: remove and re-enter to correct one." action={<Button size="sm" variant="lime" onClick={() => setOpen(true)}>Record bill</Button>}>Bills</CardTitle>
      {items.length === 0 ? <Empty title="No bills recorded" body="Type in each provider invoice as it arrives. Provider imports come in a later phase." /> : (
        <Table label="Bills" head={["Provider", "Invoice", "Period", "Amount", "INR", "Status", ""]} lead={1} minWidth={760}>
          {items.map((b) => (
            <tr key={b.id}>
              <td className="font-medium">{providerLabel(b.provider)}</td>
              <td className="font-mono text-[13px]">{b.invoiceId}</td>
              <td className="whitespace-nowrap">{fmtDate(b.periodStart)} to {fmtDate(b.periodEnd)}</td>
              <td>{fmtMoney(b.amountMinor, b.currency)}</td>
              <td>{fmtInr(b.inrMinor)} <span className="text-[12px] text-muted-foreground">@ {b.fxToInr}</span></td>
              <td><Pill tone={BILL_TONE[b.status] ?? "muted"}>{b.status}</Pill></td>
              <td className="text-right"><Remove kind="bills" id={b.id} name={`invoice ${b.invoiceId}`} /></td>
            </tr>
          ))}
        </Table>
      )}
      <Sheet open={open} onOpenChange={setOpen} title="Record a bill" description="An invoice a provider issued.">{open && <BillForm onClose={() => setOpen(false)} />}</Sheet>
    </Card>
  );
}

/* ---------- CSV import (R1315) ---------- */
const IMPORT_TONE: Record<ImportPreview["rows"][number]["status"], Tone> = { ok: "ok", duplicate: "muted", error: "bad" };
const IMPORT_SAMPLE = "provider,invoiceId,periodStart,periodEnd,amount,currency,status,note\nvercel,INV-2026-11,2026-11-01,2026-11-30,20.00,USD,paid,Pro seat";

/** Paste or choose a CSV of invoices; the server parses it and shows every line as ok, duplicate or error before anything is written. */
export function ImportBillsCard() {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<(ImportPreview & { committed?: number }) | null>(null);
  const [fileName, setFileName] = useState("");
  const { busy, error, run } = useSave();
  const stale = preview != null && preview.committed == null;
  const post = (commit: boolean) => run(async () => { const r = await adminApi<ImportPreview & { committed: number }>("/api/admin/costs/import", { method: "POST", json: { csv, commit } }); setPreview(commit ? r : { ...r, committed: undefined }); if (commit) setCsv(""); });
  const onFile = (f: File | undefined) => { if (!f) return; setFileName(f.name); f.text().then((t) => { setCsv(t); setPreview(null); }); };
  return (
    <Card>
      <CardTitle hint={`A header row then one invoice per line, columns ${"provider, invoiceId, periodStart, periodEnd, amount (12.50, major units), currency, status, note"}. Lines already on file (same provider and invoice id) are skipped, never overwritten.`}>Import invoices from CSV</CardTitle>
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-9 cursor-pointer items-center rounded-full px-3.5 text-[13px] hairline hover:bg-secondary">Choose file<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} /></label>
          {fileName && <span className="text-[12.5px] text-muted-foreground">{fileName}</span>}
          <Button type="button" variant="ghost" size="sm" onClick={() => { setCsv(IMPORT_SAMPLE); setPreview(null); }}>Paste a sample</Button>
        </div>
        <Textarea id="import-csv" aria-label="CSV" rows={5} value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} placeholder={IMPORT_SAMPLE} className="font-mono text-[12.5px]" />
        <Err text={error} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={busy || !csv.trim()} onClick={() => post(false)}>Preview</Button>
          {stale && preview.ok > 0 && <Button type="button" size="sm" variant="lime" disabled={busy} onClick={() => post(true)}>Record {preview.ok} invoice{preview.ok === 1 ? "" : "s"}</Button>}
          {preview && <span className="text-[12.5px] text-muted-foreground">{preview.committed != null ? `${preview.committed} recorded. ` : ""}{preview.ok} ok · {preview.duplicates} duplicate{preview.duplicates === 1 ? "" : "s"} · {preview.errors} error{preview.errors === 1 ? "" : "s"}</span>}
        </div>
        {preview && preview.rows.length > 0 && (
          <Table label="Import preview" head={["Line", "Provider", "Invoice", "Period", "Amount", "Result"]} lead={2} minWidth={700}>
            {preview.rows.map((r) => (
              <tr key={r.line}>
                <td className="tabular-nums text-muted-foreground">{r.line}</td>
                <td>{r.raw.provider}</td>
                <td className="font-mono text-[13px]">{r.raw.invoiceId}</td>
                <td className="whitespace-nowrap">{r.raw.periodStart} to {r.raw.periodEnd}</td>
                <td className="tabular-nums">{r.raw.amount} {r.raw.currency || "USD"}</td>
                <td><Pill tone={IMPORT_TONE[r.status]}>{r.status}</Pill>{r.reason && <span className="ml-2 text-[12.5px] text-muted-foreground">{r.reason}</span>}</td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </Card>
  );
}

/* ---------- Provider connections (R1316) ---------- */
const CONN_TONE: Record<string, Tone> = { ok: "ok", error: "bad", untested: "warn", none: "muted" };
const CONN_LABEL: Record<string, string> = { ok: "Connected", error: "Error", untested: "Untested", none: "Not connected" };

function factsLine(c: ConnectionView) {
  const f = c.facts as { plan?: string; projectCount?: number; services?: { name: string; plan: string }[]; orgs?: { name: string; plan: string }[]; projects?: unknown[] };
  const bits: string[] = [];
  if (f.plan) bits.push(`plan ${f.plan}`);
  if (f.projectCount != null) bits.push(`${f.projectCount} project${f.projectCount === 1 ? "" : "s"}`);
  if (f.services) bits.push(`${f.services.length} service${f.services.length === 1 ? "" : "s"}${f.services.length ? ` (${f.services.map((s) => `${s.name}${s.plan ? ` ${s.plan}` : ""}`).slice(0, 4).join(", ")}${f.services.length > 4 ? ", …" : ""})` : ""}`);
  if (f.orgs) bits.push(f.orgs.map((o) => `${o.name}${o.plan ? ` on ${o.plan}` : ""}`).join(", "));
  if (f.projects && !f.projectCount) bits.push(`${f.projects.length} project${f.projects.length === 1 ? "" : "s"}`);
  return bits.join(" · ");
}

function ConnectForm({ c, onClose }: { c: ConnectionView; onClose: () => void }) {
  const [token, setToken] = useState("");
  const [scope, setScope] = useState(c.scope);
  const { busy, error, run } = useSave();
  return (
    <form className="grid gap-4 pt-2" noValidate onSubmit={(e) => { e.preventDefault(); run(() => adminApi("/api/admin/costs/connections", { method: "POST", json: { provider: c.provider, token, scope } }), onClose); }}>
      <p className="text-[13px] text-muted-foreground">{c.capability}</p>
      <Field id={`cn-token-${c.provider}`} label="API token" hint={c.tokenHelp}><Input id={`cn-token-${c.provider}`} type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} placeholder={c.last4 ? `Replace the token ending …${c.last4}` : "Paste the token"} /></Field>
      {c.scopeLabel && <Field id={`cn-scope-${c.provider}`} label={c.scopeLabel} hint={c.scopeHelp}><Input id={`cn-scope-${c.provider}`} value={scope} onChange={(e) => setScope(e.target.value)} /></Field>}
      <p className="text-[12.5px] text-muted-foreground">The token is checked against {c.providerLabel} before it is saved, stored encrypted, and only its last four characters are ever shown again.</p>
      <Err text={error} />
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant="lime" disabled={busy || token.trim().length < 8}>{busy ? "Checking…" : c.id ? "Replace token" : "Connect"}</Button></div>
    </form>
  );
}

/** One row per provider adapter: status, what the last test learned, and connect / re-test / sync / remove. */
export function ConnectionsCard({ items }: { items: ConnectionView[] }) {
  const [open, setOpen] = useState<ConnectionView | null>(null);
  const { busy, error, run } = useSave();
  const act = (c: ConnectionView, what: "test" | "sync") => run(() => what === "test" ? adminApi(`/api/admin/costs/connections/${c.provider}`, { method: "PATCH", json: {} }) : adminApi("/api/admin/costs/sync", { method: "POST", json: { provider: c.provider } }));
  return (
    <Card>
      <CardTitle hint="Read-only tokens, encrypted at rest. The nightly sweep pulls what each provider's public API exposes and books it with a reference, so a re-run never double counts. Each row says plainly what its API cannot show.">Provider connections</CardTitle>
      <Err text={error} />
      <ul className="grid gap-3">
        {items.map((c) => (
          <li key={c.provider} className="rounded-2xl bg-secondary/40 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{c.providerLabel}</span><Pill tone={CONN_TONE[c.status] ?? "muted"}>{CONN_LABEL[c.status] ?? c.status}</Pill>{c.label && <span className="text-[12.5px] text-muted-foreground">{c.label}</span>}</div>
                <p className="mt-1 text-[12.5px] text-muted-foreground">{c.capability}</p>
                {c.id && <p className="mt-1 text-[12.5px] text-muted-foreground">{factsLine(c) || "Nothing learned yet."}{c.lastSyncAt ? ` · synced ${fmtDate(c.lastSyncAt)}` : c.lastTestAt ? ` · tested ${fmtDate(c.lastTestAt)}` : ""}{c.last4 ? ` · token …${c.last4}` : ""}</p>}
                {c.lastError && <p role="alert" className="mt-1 text-[12.5px] text-[hsl(0_72%_38%)] dark:text-destructive">{c.lastError}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                {c.id && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => act(c, "test")}>Re-test</Button>}
                {c.id && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => act(c, "sync")}>Sync now</Button>}
                <Button type="button" size="sm" variant={c.id ? "ghost" : "lime"} onClick={() => setOpen(c)}>{c.id ? "Replace token" : "Connect"}</Button>
                {c.id && <Remove kind="connections" id={c.provider} name={`the ${c.providerLabel} connection`} />}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open ? `Connect ${open.providerLabel}` : ""} description="A read-only token so the sweep can pull plans and usage.">{open && <ConnectForm c={open} onClose={() => setOpen(null)} />}</Sheet>
    </Card>
  );
}

/* ---------- Budgets ---------- */
type BudgetDraft = { name: string; scope: string; key: string; amount: string; thresholds: string; active: boolean };
const budgetDraft = (b: BudgetView | null): BudgetDraft => b ? { name: b.name, scope: b.scope, key: b.key, amount: major(b.inrMinor), thresholds: b.thresholds, active: b.active } : { name: "", scope: "total", key: "", amount: "", thresholds: "50,75,90,100", active: true };

function BudgetForm({ item, onClose }: { item: BudgetView | null; onClose: () => void }) {
  const [f, setF] = useState(() => budgetDraft(item));
  const set = <K extends keyof BudgetDraft>(k: K, v: BudgetDraft[K]) => setF((x) => ({ ...x, [k]: v }));
  const { busy, error, run } = useSave();
  const body = { name: f.name, scope: f.scope, key: f.scope === "total" ? "" : f.key, inrMinor: minorOf(f.amount), thresholds: f.thresholds, active: f.active };
  const keyOptions = f.scope === "provider" ? PROVIDERS.map((p) => [p.id, p.label]) : f.scope === "category" ? COST_CATEGORIES.map((c) => [c, CATEGORY_LABEL[c]]) : f.scope === "feature" ? Object.entries(FEATURE_LABEL) : [];
  return (
    <form className="grid gap-4 pt-2" noValidate onSubmit={(e) => { e.preventDefault(); run(() => (item ? adminApi(`/api/admin/costs/budgets/${item.id}`, { method: "PATCH", json: body }) : adminApi("/api/admin/costs/budgets", { method: "POST", json: body })), onClose); }}>
      <Field id="bg-name" label="Name"><Input id="bg-name" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Everything, November" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="bg-scope" label="Applies to"><Select id="bg-scope" value={f.scope} onChange={(v) => { set("scope", v); set("key", ""); }}><option value="total">Everything</option><option value="provider">One provider</option><option value="category">One category</option><option value="feature">One feature</option></Select></Field>
        {f.scope !== "total" && <Field id="bg-key" label="Which"><Select id="bg-key" value={f.key} onChange={(v) => set("key", v)}><option value="">Choose…</option>{keyOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="bg-amount" label="Monthly limit (₹)"><Input id="bg-amount" type="number" inputMode="decimal" min={1} step="1" value={f.amount} onChange={(e) => set("amount", e.target.value)} placeholder="5000" /></Field>
        <Field id="bg-th" label="Alert at (% steps)" hint="Each step raises one alert per month."><Input id="bg-th" value={f.thresholds} onChange={(e) => set("thresholds", e.target.value)} /></Field>
      </div>
      {item && <SwitchRow id="bg-active" label="Active" on={f.active} onChange={(v) => set("active", v)} />}
      <Err text={error} />
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant="lime" disabled={busy || !f.name || minorOf(f.amount) <= 0 || (f.scope !== "total" && !f.key)}>{busy ? "Saving…" : item ? "Save" : "Set budget"}</Button></div>
    </form>
  );
}

const pctTone = (pct: number): Tone => (pct >= 100 ? "bad" : pct >= 75 ? "warn" : "ok");

export function BudgetsCard({ items }: { items: BudgetView[] }) {
  const [edit, setEdit] = useState<BudgetView | null | false>(false);
  return (
    <Card>
      <CardTitle hint="Monthly limits in INR. Spend is this calendar month's ledger total for the scope; crossing a step raises one alert." action={<Button size="sm" variant="lime" onClick={() => setEdit(null)}>Set budget</Button>}>Budgets</CardTitle>
      {items.length === 0 ? <Empty title="No budgets" body="Start with one for everything, then add one per provider you want watched." /> : (
        <ul className="grid gap-3">
          {items.map((b) => (
            <li key={b.id} className="rounded-2xl bg-secondary/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><span className="font-medium">{b.name}</span> <span className="text-[12.5px] text-muted-foreground">{b.scope === "total" ? "everything" : `${b.scope}: ${b.key}`}</span></div>
                <div className="flex items-center gap-2"><Pill tone={b.active ? pctTone(b.pct) : "muted"}>{b.pct}%</Pill><Button type="button" variant="ghost" size="sm" onClick={() => setEdit(b)}>Edit</Button><Remove kind="budgets" id={b.id} name={b.name} /></div>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, b.pct)} aria-label={`${b.name} used`}><div className={`h-full rounded-full ${b.pct >= 100 ? "bg-destructive" : b.pct >= 75 ? "bg-amber-500" : "lime-bg"}`} style={{ width: `${Math.min(100, b.pct)}%` }} /></div>
              <p className="mt-1.5 text-[12.5px] text-muted-foreground">{fmtInr(b.spentMinor)} of {fmtInr(b.inrMinor)} this month · alerts at {b.thresholds}%</p>
            </li>
          ))}
        </ul>
      )}
      <Sheet open={edit !== false} onOpenChange={(o) => !o && setEdit(false)} title={edit ? "Edit budget" : "New budget"} description="Alerts only. Nothing is switched off when a budget is reached.">
        {edit !== false && <BudgetForm key={edit?.id ?? "new"} item={edit} onClose={() => setEdit(false)} />}
      </Sheet>
    </Card>
  );
}

/* ---------- Alerts ---------- */
const SEV_TONE: Record<string, Tone> = { info: "muted", warn: "warn", critical: "bad" };
export function AlertsCard({ items }: { items: AlertView[] }) {
  const { busy, run } = useSave();
  const open = items.filter((a) => a.status === "open");
  return (
    <Card>
      <CardTitle hint="One alert per condition: a budget step, a renewal within a week, a provider whose day was several times its usual. Warn and critical ones also go to the System Health alert email. Acknowledging hides it; it will not come back for the same step.">Alerts{open.length ? ` (${open.length})` : ""}</CardTitle>
      {items.length === 0 ? <Empty title="Nothing to flag" body="Budget steps and upcoming renewals show up here." /> : (
        <ul className="divide-y divide-border/60">
          {items.slice(0, 12).map((a) => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><Pill tone={a.status === "open" ? SEV_TONE[a.severity] ?? "muted" : "muted"}>{a.status === "open" ? a.severity : "acked"}</Pill><span className="font-medium">{a.title}</span></div>
                {a.body && <p className="mt-1 text-[13px] text-muted-foreground">{a.body}</p>}
                <p className="mt-0.5 text-[12px] text-muted-foreground">{fmtDate(a.createdAt, true)}{a.ackedBy ? ` · acknowledged by ${a.ackedBy}` : ""}</p>
              </div>
              {a.status === "open" && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => run(() => adminApi(`/api/admin/costs/alerts/${a.id}`, { method: "PATCH", json: {} }))}>Acknowledge</Button>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ---------- Unit prices ---------- */
type PriceDraft = { provider: string; sku: string; unit: string; price: string; currency: string; effectiveFrom: string; sourceUrl: string; note: string };
function PriceForm({ base, onClose }: { base: PriceView | null; onClose: () => void }) {
  const [f, setF] = useState<PriceDraft>(() => base ? { provider: base.provider, sku: base.sku, unit: base.unit, price: String(base.price), currency: base.currency, effectiveFrom: today(), sourceUrl: base.sourceUrl, note: "" } : { provider: "gemini", sku: "", unit: "token", price: "", currency: "USD", effectiveFrom: today(), sourceUrl: "", note: "" });
  const set = <K extends keyof PriceDraft>(k: K, v: PriceDraft[K]) => setF((x) => ({ ...x, [k]: v }));
  const { busy, error, run } = useSave();
  const body = { ...f, price: Number(f.price) };
  return (
    <form className="grid gap-4 pt-2" noValidate onSubmit={(e) => { e.preventDefault(); run(() => adminApi("/api/admin/costs/prices", { method: "POST", json: body }), onClose); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pr-provider" label="Provider"><Select id="pr-provider" value={f.provider} onChange={(v) => set("provider", v)}><ProviderOptions /></Select></Field>
        <Field id="pr-sku" label="SKU" hint="Model and side, like gemini-2.5-flash:output"><Input id="pr-sku" value={f.sku} spellCheck={false} onChange={(e) => set("sku", e.target.value)} className="font-mono text-[14px]" /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="pr-price" label="Price per unit" hint="Tokens are per single token (0.0000025 = $2.50 per million)."><Input id="pr-price" type="number" inputMode="decimal" min={0} step="any" value={f.price} onChange={(e) => set("price", e.target.value)} /></Field>
        <Field id="pr-currency" label="Currency"><Select id="pr-currency" value={f.currency} onChange={(v) => set("currency", v)}><CurrencyOptions /></Select></Field>
        <Field id="pr-unit" label="Unit"><Input id="pr-unit" value={f.unit} onChange={(e) => set("unit", e.target.value)} placeholder="token" /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pr-from" label="Effective from" hint="Earlier rows keep pricing what they already priced."><Input id="pr-from" type="date" value={f.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} /></Field>
        <Field id="pr-url" label="Source URL"><Input id="pr-url" type="url" value={f.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} placeholder="https://ai.google.dev/gemini-api/docs/pricing" /></Field>
      </div>
      <Field id="pr-note" label="Note"><Input id="pr-note" value={f.note} maxLength={300} onChange={(e) => set("note", e.target.value)} /></Field>
      <Err text={error} />
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant="lime" disabled={busy || !f.sku || !(Number(f.price) >= 0) || !f.price}>{busy ? "Saving…" : "Save price"}</Button></div>
    </form>
  );
}

const fmtPrice = (p: PriceView) => (p.unit === "token" ? `${p.currency} ${(p.price * 1e6).toFixed(2)} / 1M tokens` : `${p.currency} ${p.price} / ${p.unit}`);

export function PricesCard({ items }: { items: PriceView[] }) {
  const [edit, setEdit] = useState<PriceView | null | false>(false);
  const [history, setHistory] = useState(false);
  const shown = history ? items : items.filter((p) => p.current);
  return (
    <Card>
      <CardTitle hint="What one unit costs, with history. Seeded rows are the public list prices when this shipped: confirm them against the provider's page. A new price never reprices what was already booked." action={<div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setHistory((h) => !h)}>{history ? "Current only" : "Show history"}</Button><Button size="sm" variant="lime" onClick={() => setEdit(null)}>Add price</Button></div>}>Unit prices</CardTitle>
      <Table label="Unit prices" head={["Provider", "SKU", "Price", "From", "Source", ""]} lead={1} minWidth={720}>
        {shown.map((p) => (
          <tr key={p.id} className={p.current ? "" : "opacity-60"}>
            <td className="font-medium">{providerLabel(p.provider)}</td>
            <td className="font-mono text-[13px]">{p.sku}</td>
            <td>{fmtPrice(p)}</td>
            <td className="whitespace-nowrap">{fmtDate(p.effectiveFrom)}{p.effectiveTo ? ` to ${fmtDate(p.effectiveTo)}` : ""}</td>
            <td><Pill tone={p.source === "seed" ? "warn" : p.source === "official" ? "ok" : "muted"}>{p.source === "seed" ? "seed, verify" : p.source}</Pill>{p.sourceUrl && <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="ml-2 text-[12.5px] underline-offset-2 hover:underline">source</a>}</td>
            <td className="text-right">{p.current && <Button type="button" variant="ghost" size="sm" onClick={() => setEdit(p)}>Override</Button>}</td>
          </tr>
        ))}
      </Table>
      <Sheet open={edit !== false} onOpenChange={(o) => !o && setEdit(false)} title={edit ? `New price for ${edit.sku}` : "Add a unit price"} description="Adds a row from the date you give; the old row ends there.">
        {edit !== false && <PriceForm key={edit?.id ?? "new"} base={edit} onClose={() => setEdit(false)} />}
      </Sheet>
    </Card>
  );
}

/** The sweep normally runs on the housekeeping slot; this runs it now (books due renewals, re-checks budgets). */
export function SweepNowButton() {
  const { busy, run } = useSave();
  return <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => run(() => adminApi("/api/admin/costs/sweep", { method: "POST", json: {} }))}>{busy ? "Checking…" : "Check renewals & budgets now"}</Button>;
}
