"use client";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Card, CardTitle, Pill, Table, fmtDate } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/Toast";
import { cn } from "@/lib/utils";
import { errorsOf, policyApi, type FieldError, type GridRow, type PolicyForm, type PolicyState, type Preview } from "./api";
import { chip, MarginBadge, money, pct, useDebounced } from "./shared";

const MODES = [["off", "Off", "No budget, no meter"], ["alert", "Alert", "Meter warns at 80% and 100%, nothing pauses"], ["enforce", "Enforce", "At 100% only AI, captions and X posts pause until next month or a pack"]] as const;
const major = (minor: number | undefined) => (minor == null ? "" : String(minor / 100));
const toMinor = (s: string) => {
  const n = Number(s.replace(/,/g, "").trim());
  return s.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
};

export function PolicyPanel() {
  const toast = useToast();
  const [s, setS] = useState<PolicyState | null>(null);
  const [form, setForm] = useState<PolicyForm | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [grid, setGrid] = useState<GridRow[]>([]);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<"enable" | "disable" | "undo" | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [cycle, setCycle] = useState<"month" | "year">("month");

  function adopt(st: PolicyState) {
    setS(st);
    setForm(st.form);
    setGrid(st.grid);
    setErrors(st.errors);
    const t: Record<string, string> = {};
    for (const [plan, byCur] of Object.entries(st.form.intro)) for (const [cur, v] of Object.entries(byCur)) t[`${plan}.${cur}`] = major(v);
    setText(t);
  }
  useEffect(() => {
    policyApi.load().then(adopt).catch((e: Error) => toast(e.message, "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const badInput = useMemo(() => Object.entries(text).filter(([, v]) => Number.isNaN(toMinor(v))).map(([k]) => k), [text]);
  const dirty = useMemo(() => !!s && !!form && JSON.stringify(form) !== JSON.stringify(s.form), [s, form]);
  const live = useDebounced(form, 350);
  useEffect(() => {
    if (!live || !dirty || badInput.length) return;
    let gone = false;
    setChecking(true);
    policyApi
      .check(live)
      .then((r) => { if (!gone) { setGrid(r.grid); setErrors(r.errors); } })
      .catch((e: Error) => !gone && toast(e.message, "error"))
      .finally(() => !gone && setChecking(false));
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  if (!s || !form) return <p className="text-[13.5px] text-muted-foreground" role="status">Loading the policy</p>;

  const setIntro = (plan: string, cur: string, v: string) => {
    setText((t) => ({ ...t, [`${plan}.${cur}`]: v }));
    const m = toMinor(v);
    if (!Number.isNaN(m)) setForm((f) => f && { ...f, intro: { ...f.intro, [plan]: { ...f.intro[plan], [cur]: m } } });
  };
  const setNum = (k: "graceDays" | "trialDays" | "refundWindowDays", v: string, max: number) => setForm((f) => f && { ...f, [k]: Math.max(0, Math.min(max, Math.floor(Number(v) || 0))) });
  const fieldErr = (field: string) => errors.find((e) => e.field === field)?.message;
  const below = grid.filter((g) => !g.ok && g.tier === "intro");
  const stdBelow = grid.filter((g) => !g.ok && g.tier === "standard");
  const cell = (plan: string, cur: string, tier: GridRow["tier"]) => grid.find((g) => g.plan === plan && g.currency === cur && g.interval === cycle && g.tier === tier);

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      adopt(await policyApi.save(form));
      toast("Policy saved. Existing subscribers keep the price they bought at.");
    } catch (e) {
      const errs = errorsOf(e);
      if (errs.length) setErrors(errs);
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function openAsk(a: "enable" | "disable" | "undo") {
    setAsk(a);
    if (a === "enable") {
      setPreview(null);
      policyApi.preview().then(setPreview).catch((e: Error) => toast(e.message, "error"));
    }
  }
  async function run(a: "enable" | "disable" | "undo") {
    setBusy(true);
    try {
      adopt(await policyApi.run(a));
      toast(a === "enable" ? "First-time pricing and trials are live" : a === "disable" ? "Policy off. Checkout is back to the plan prices." : "The previous policy is back");
    } catch (e) {
      const errs = errorsOf(e);
      if (errs.length) setErrors(errs);
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      setAsk(null);
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 font-display text-[1.05rem] font-semibold">
              Subscription policy <Pill tone={s.enabled ? "ok" : "muted"}>{s.enabled ? "On" : "Off"}</Pill> <span className="text-[12.5px] font-normal text-muted-foreground">version {s.version}</span>
            </h2>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {s.enabled
                ? "First-time prices, the trial, anti-abuse and the cost budget are live. Subscriptions from before it was enabled stay legacy forever."
                : "Off: checkout, renewals and billing behave exactly as before. Enable shows a preview first."}
              {s.prev ? ` Last change ${fmtDate(s.prev.at, true)} by ${s.prev.by}.` : ""}
            </p>
          </div>
          {s.prev && <Button type="button" variant="ghost" className="rounded-full" disabled={busy} onClick={() => openAsk("undo")}>Undo last change</Button>}
          {s.enabled ? (
            <Button type="button" variant="outline" className="rounded-full" disabled={busy} onClick={() => openAsk("disable")}>Turn off</Button>
          ) : (
            <Button type="button" variant="lime" className="rounded-full" disabled={busy || dirty || below.length > 0} title={dirty ? "Save your edits first" : below.length ? "Every price must clear the floor" : undefined} onClick={() => openAsk("enable")}>Preview and enable</Button>
          )}
        </div>
      </Card>

      <Card>
        <CardTitle
          hint={`Every price is checked against the ${pct(s.targetMargin)} margin floor at typical usage. Returning prices are the live plan prices from Pricing. Yearly first-time prices are worked out by the engine and never go below their floor.`}
          action={
            <div className="flex gap-1.5" role="group" aria-label="Billing cycle">
              {(["month", "year"] as const).map((c) => <button key={c} type="button" aria-pressed={cycle === c} onClick={() => setCycle(c)} className={chip(cycle === c)}>{c === "month" ? "Monthly" : "Yearly"}</button>)}
            </div>
          }
        >
          First-time prices and the margin check
        </CardTitle>
        <p className="sr-only" aria-live="polite">{checking ? "Checking margins" : below.length ? `${below.length} prices are below the floor` : "All prices clear the floor"}</p>
        <Table label="Prices and margins" mobile="scroll" minWidth={760} head={["Plan", "Currency", "First-time price", "Floor", "First-time margin", "Returning price", "Returning margin"]}>
          {s.plans.flatMap((p) =>
            s.currencies.map((cur) => {
              const intro = cell(p.slug, cur, "intro");
              const std = cell(p.slug, cur, "standard");
              const key = `${p.slug}.${cur}`;
              const err = fieldErr(`intro.${p.slug}.${cur}`) ?? (badInput.includes(key) ? "Enter a number" : undefined);
              const id = `intro-${p.slug}-${cur}`;
              return (
                <tr key={key}>
                  <td className="font-medium">{p.name}</td>
                  <td>{cur}</td>
                  <td>
                    {cycle === "month" ? (
                      <div className="w-32">
                        <label htmlFor={id} className="sr-only">{`${p.name} first-time monthly price in ${cur}`}</label>
                        <Input id={id} inputMode="decimal" value={text[key] ?? ""} onChange={(e) => setIntro(p.slug, cur, e.target.value)} aria-invalid={!!err || (intro ? !intro.ok : false)} aria-describedby={err ? `${id}-err` : undefined} className={cn("tabular", (err || (intro && !intro.ok)) && "ring-2 ring-destructive")} />
                        {err && <p id={`${id}-err`} className="mt-1 text-[12px] text-foreground">{err}</p>}
                      </div>
                    ) : (
                      <span className="tabular">{money(intro?.priceMinor, cur)}</span>
                    )}
                  </td>
                  <td className="tabular text-muted-foreground">{intro ? money(intro.floorMinor, cur) : "n/a"}</td>
                  <td>{intro ? <MarginBadge margin={intro.margin} target={s.targetMargin} /> : "n/a"}</td>
                  <td className="tabular">{std?.priceMinor != null ? money(std.priceMinor, cur) : "Not sold"}</td>
                  <td>{std?.priceMinor != null ? <MarginBadge margin={std.margin} target={s.targetMargin} /> : "n/a"}</td>
                </tr>
              );
            }),
          )}
        </Table>
        {below.length > 0 && (
          <p role="alert" className="mt-3 rounded-2xl bg-destructive/10 px-4 py-2 text-[13px] text-foreground">
            {below.length} first-time price{below.length === 1 ? " is" : "s are"} below the {pct(s.targetMargin)} floor. Saving is refused until each one is at or above its floor.
          </p>
        )}
        {stdBelow.length > 0 && (
          <p className="mt-3 rounded-2xl bg-warning/12 px-4 py-2 text-[13px] text-foreground">
            {stdBelow.length} returning price{stdBelow.length === 1 ? " is" : "s are"} below the floor ({[...new Set(stdBelow.map((b) => `${b.planName} ${b.currency}`))].join(", ")}). Returning prices are edited on the Pricing page.
          </p>
        )}
      </Card>

      <Card>
        <CardTitle hint="Trial length, lapse grace, refund window and how the monthly cost budget behaves for heavy users.">Rules</CardTitle>
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField id="pol-trial" label="Trial days" hint="Up to 7. 0 turns trials off." value={form.trialDays} max={7} onChange={(v) => setNum("trialDays", v, 7)} error={fieldErr("trialDays")} />
          <NumberField id="pol-grace" label="Grace days after a missed renewal" hint="Past this, the first-time price is gone." value={form.graceDays} max={30} onChange={(v) => setNum("graceDays", v, 30)} error={fieldErr("graceDays")} />
          <NumberField id="pol-refund" label="Refund window days" hint="A refunded first period still counts as used." value={form.refundWindowDays} max={365} onChange={(v) => setNum("refundWindowDays", v, 365)} error={fieldErr("refundWindowDays")} />
        </div>
        <fieldset className="mt-5">
          <legend className="mb-2 text-[13px] font-semibold">Cost budget</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODES.map(([k, label, hint]) => (
              <label key={k} className={cn("flex min-h-[44px] cursor-pointer gap-3 rounded-2xl px-4 py-3 hairline focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring", form.budgetMode === k ? "bg-secondary" : "bg-secondary/30")}>
                <input type="radio" name="budget-mode" value={k} checked={form.budgetMode === k} onChange={() => setForm({ ...form, budgetMode: k })} className="mt-1 h-4 w-4 accent-current" />
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium">{label}</span>
                  <span className="block text-[12px] text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">Never applies to Free, legacy or founding subscribers.</p>
        </fieldset>
        {form.risk.length > 0 && (
          <fieldset className="mt-5">
            <legend className="mb-2 text-[13px] font-semibold">Anti-abuse weights and thresholds</legend>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {form.risk.map((r, i) => (
                <NumberField key={r.path} id={`risk-${i}`} label={r.label} value={r.value} min={-100} max={200} error={fieldErr(`risk.${r.path}`)}
                  onChange={(v) => setForm({ ...form, risk: form.risk.map((x, j) => (j === i ? { ...x, value: Math.max(-100, Math.min(200, Math.round(Number(v) || 0))) } : x)) })} />
              ))}
            </div>
          </fieldset>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button type="button" variant="lime" className="rounded-full" disabled={busy || !dirty || badInput.length > 0 || below.length > 0 || checking} onClick={save}>Save policy</Button>
          {dirty && <Button type="button" variant="ghost" className="rounded-full" disabled={busy} onClick={() => adopt(s)}>Discard edits</Button>}
          <span className="text-[12.5px] text-muted-foreground" aria-live="polite">{checking ? "Checking margins" : dirty ? "Unsaved edits" : "Saved"}</span>
        </div>
      </Card>

      <ConfirmDialog
        open={ask === "enable"}
        onOpenChange={(o) => !o && setAsk(null)}
        tone="primary"
        size="wide"
        title="Enable first-time pricing and the trial?"
        body="New subscribers get the first-time price once, the 7-day trial becomes available and heavy usage is kept inside the monthly cost budget. Nobody already subscribed is re-priced."
        confirmLabel="Enable policy"
        cancelLabel="Not yet"
        busy={busy}
        disabled={!preview}
        onConfirm={() => run("enable")}
        extra={
          !preview ? (
            <p className="text-[13px] text-muted-foreground" role="status">Working out what changes</p>
          ) : (
            <ul className="grid gap-1.5 text-[13px]">
              <li>{preview.activeSubs} active subscription{preview.activeSubs === 1 ? "" : "s"}: {preview.legacy} stay legacy at their current price, {preview.founding} keep the founding discount.</li>
              {preview.changes.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          )
        }
      />
      <ConfirmDialog open={ask === "disable"} onOpenChange={(o) => !o && setAsk(null)} title="Turn the policy off?" body="Checkout goes back to the plan prices and no new trials start. People who already bought keep their snapshotted price, and running trials end on their date." confirmLabel="Turn off" busy={busy} onConfirm={() => run("disable")} />
      <ConfirmDialog open={ask === "undo"} onOpenChange={(o) => !o && setAsk(null)} title="Undo the last change?" body={s.prev ? `The policy goes back to version ${s.prev.version} (${s.prev.enabled ? "on" : "off"}), as saved before ${fmtDate(s.prev.at, true)}.` : ""} confirmLabel="Undo" busy={busy} onConfirm={() => run("undo")} />
    </div>
  );
}

function NumberField({ id, label, hint, value, onChange, error, min = 0, max }: { id: string; label: string; hint?: string; value: number; onChange: (v: string) => void; error?: string; min?: number; max: number }) {
  return (
    <div className="min-w-0">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" inputMode="numeric" min={min} max={max} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={hint || error ? `${id}-hint` : undefined} className="tabular" />
      {(hint || error) && <p id={`${id}-hint`} className={cn("mt-1 text-[12px]", error ? "text-foreground" : "text-muted-foreground")}>{error ?? hint}</p>}
    </div>
  );
}
