"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { adminApi } from "@/lib/client/admin-api";
import { formatMoney } from "@/lib/billing/money";
import { Card, CardTitle, Empty, Pill, Table, fmtDate } from "@/components/admin/ui";
import { CANCEL_REASON_LABEL, type CancelReason, type ExperimentsConfig } from "@/lib/billing/experiments-core";
import { TOPUP_KINDS, type TopUpConfig, type TopUpKind, type TopUpPack } from "@/lib/billing/topups-core";

const FX = ["USD", "EUR", "GBP"] as const;
const KIND_LABEL: Record<TopUpKind, string> = { ai: "AI captions (videos)", x: "X posts", brand: "Extra brand", seat: "Extra seat" };

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const money = (minor: number | null, cur: string) => (minor == null ? "n/a" : formatMoney(minor, cur));
const intIn = (v: string, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(Number(v) || 0)));

function Switch({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-2xl bg-secondary/40 px-4 py-2 hairline">
      <span className="min-w-0">
        <span className="block text-[14px] font-medium">{label}</span>
        {hint && <span className="block text-[12px] text-muted-foreground">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span aria-hidden className="relative h-7 w-12 shrink-0 rounded-full bg-muted transition-colors peer-checked:bg-lime peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-background after:shadow after:transition-transform after:duration-300 peer-checked:after:translate-x-5 motion-reduce:after:transition-none" />
    </label>
  );
}

// ------------------------------------------------------------------ preset (shown inside the plan editor)

type PresetState = { preset: string; plans: string[]; applied: boolean; appliedAt: string | null; appliedBy: string | null; stale?: { plans: string[]; packs: number }; revision?: { name: string; applied: boolean; appliedAt: string | null; appliedBy: string | null } };

/**
 * The November 2026 pricing, applied only when an admin presses the button. A backup of every touched row
 * is kept, so Undo puts the plans back exactly. People already subscribed keep their price until renewal.
 */
export function PresetPanel({ onChanged }: { onChanged: () => Promise<void> | void }) {
  const toast = useToast();
  const [s, setS] = useState<PresetState | null>(null);
  const [ask, setAsk] = useState<"apply" | "undo" | "rev" | "rev-undo" | null>(null);
  const [endBeta, setEndBeta] = useState(false);
  const [founding, setFounding] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    adminApi<PresetState>("/api/admin/plans/preset").then(setS).catch(() => {});
  }, []);
  async function run(undo: boolean | "copy" | "rev" | "rev-undo") {
    setBusy(true);
    try {
      const body = undo === "rev" ? { revision: "apply" } : undo === "rev-undo" ? { revision: "undo" } : undo === "copy" ? { fixCopy: true } : undo ? { undo: true } : { endBeta, enableFounding: founding };
      const r = await adminApi<PresetState>("/api/admin/plans/preset", { method: "POST", json: body });
      setS(r);
      await onChanged();
      toast(undo === "rev" ? "Revised pricing is live" : undo === "rev-undo" ? "The previous November plans are back" : undo === "copy" ? "Plan wording fixed" : undo ? "The previous plans are back" : "November 2026 pricing is live");
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
      setAsk(null);
    }
  }
  if (!s) return null;
  return (
    <section aria-labelledby="pc-preset-h" className="la-card la-themed relative overflow-hidden rounded-[2rem] p-4 sm:p-5">
      <span className="la-grid rounded-[inherit]" aria-hidden="true" />
      <div className="relative flex flex-wrap items-center gap-3">
        <div className="mr-auto min-w-0">
          <h2 id="pc-preset-h" className="text-[15px] font-semibold">November 2026 pricing</h2>
          <p className="mt-0.5 text-[12.5px] la-mute">
            {s.applied
              ? `Applied ${fmtDate(s.appliedAt, true)} by ${s.appliedBy}. Edit any plan below as usual, or undo to put the old rows back.`
              : "Free, Starter ₹299, Creator ₹799, Agency ₹2,499, with brands, X caps, history and perks. Studio is hidden, not deleted. Nothing changes until you press Apply."}
          </p>
          {s.stale && (s.stale.plans.length > 0 || s.stale.packs > 0) && (
            <p className="mt-1 text-[12.5px] font-medium">
              {s.stale.plans.join(", ")}{s.stale.plans.length && s.stale.packs ? " and " : ""}{s.stale.packs ? `${s.stale.packs} top-up pack${s.stale.packs === 1 ? "" : "s"}` : ""} still say "AI videos" (Outlly captions videos, it doesn't make them) or promise brand add-ons that aren't on sale. Fix plan wording swaps only those lines.
            </p>
          )}
        </div>
        {s.stale && (s.stale.plans.length > 0 || s.stale.packs > 0) && (
          <Button type="button" variant="lime" className="rounded-full" disabled={busy} onClick={() => run("copy")}>Fix plan wording</Button>
        )}
        {s.applied ? (
          <Button type="button" variant="ghost" className="rounded-full" disabled={busy || !!s.revision?.applied} title={s.revision?.applied ? "Undo the revised pricing first" : undefined} onClick={() => setAsk("undo")}>Undo preset</Button>
        ) : (
          <Button type="button" variant="lime" className="rounded-full" disabled={busy} onClick={() => setAsk("apply")}>Apply Nov 2026 pricing</Button>
        )}
      </div>
      {s.applied && s.revision && (
        <div className="relative mt-4 flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
          <div className="mr-auto min-w-0">
            <h3 className="text-[14px] font-semibold">Revised prices and limits (unit economics)</h3>
            <p className="mt-0.5 text-[12.5px] la-mute">
              {s.revision.applied
                ? `Applied ${fmtDate(s.revision.appliedAt, true)} by ${s.revision.appliedBy}. Undo puts back the plans and packs it replaced.`
                : "Starter ₹379, Creator ₹979, Agency ₹3,479 ($8 / $17 / $43) with monthly caps on posts, X, AI captions and AI requests. Free loses X. Packs repriced (X +50 for ₹449)."}
            </p>
          </div>
          {s.revision.applied ? (
            <Button type="button" variant="ghost" className="rounded-full" disabled={busy} onClick={() => setAsk("rev-undo")}>Undo revision</Button>
          ) : (
            <Button type="button" variant="lime" className="rounded-full" disabled={busy} onClick={() => setAsk("rev")}>Apply revised pricing</Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={ask === "rev"}
        onOpenChange={(o) => !o && setAsk(null)}
        tone="primary"
        title="Apply the revised prices and limits?"
        body="Free, Starter, Creator and Agency get the new prices and monthly caps, and the top-up packs are repriced. People already subscribed keep what they pay until they renew or change plan. You can undo this."
        confirmLabel="Apply revision"
        cancelLabel="Not yet"
        busy={busy}
        onConfirm={() => run("rev")}
      />
      <ConfirmDialog
        open={ask === "rev-undo"}
        onOpenChange={(o) => !o && setAsk(null)}
        title="Undo the revised pricing?"
        body="The four plans and the packs go back to the rows saved when the revision was applied, including any edits since."
        confirmLabel="Undo revision"
        busy={busy}
        onConfirm={() => run("rev-undo")}
      />
      <ConfirmDialog
        open={ask === "apply"}
        onOpenChange={(o) => !o && setAsk(null)}
        tone="primary"
        title="Apply the November 2026 plans?"
        body="Free, Creator and Pro (renamed Agency) get the new prices, limits and perks; Starter is created; Studio is hidden. People already subscribed keep what they pay until they renew or change plan. You can undo this."
        confirmLabel="Apply pricing"
        cancelLabel="Not yet"
        busy={busy}
        onConfirm={() => run(false)}
        extra={
          <div className="grid gap-2">
            <Switch label="End free beta" hint="Paid plans start charging" checked={endBeta} onChange={setEndBeta} />
            <Switch label="Open founding offer" hint="Lifetime discount for the first members" checked={founding} onChange={setFounding} />
          </div>
        }
      />
      <ConfirmDialog
        open={ask === "undo"}
        onOpenChange={(o) => !o && setAsk(null)}
        title="Undo the November 2026 pricing?"
        body="Every plan goes back to the row saved when the preset was applied, including any edits since. Starter is deleted if nobody paid for it, otherwise hidden."
        confirmLabel="Undo preset"
        busy={busy}
        onConfirm={() => run(true)}
      />
    </section>
  );
}

// ------------------------------------------------------------------ the lab (its own section on the pricing page)

type Variant = { variant: string; exposures: number; checkouts: number; paid: number; revenueMinor: number; rate: number; revenuePerVisitor: number; z: number; significant: boolean };
type Lab = {
  topups: TopUpConfig;
  experiments: ExperimentsConfig;
  results: { experiment: string; variants: Variant[] };
  survey: { survey: string; total: number; groups: { plan: string; currency: string; n: number; opp: number | null; ipp: number | null; pmc: number | null; pme: number | null }[] };
  cancels: { counts: { reason: CancelReason; count: number }[]; recent: { id: string; reason: CancelReason; detail: string; interview: boolean; contact: string | null; status: string; planSlug: string; createdAt: string; email: string; name: string }[] };
  metrics: { cohort: number; converted: number; freeToPaid60: number; liveThen: number; cancelled: number; churn: number; rule: { freeToPaid60: number; churn: number }; keep: boolean; enoughData: boolean };
};

export function PricingLab() {
  const toast = useToast();
  const [lab, setLab] = useState<Lab | null>(null);
  const [topups, setTopups] = useState<TopUpConfig | null>(null);
  const [exp, setExp] = useState<ExperimentsConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await adminApi<Lab>("/api/admin/pricing-lab");
    setLab(r);
    setTopups(r.topups);
    setExp(r.experiments);
  }, []);
  useEffect(() => {
    load().catch((e) => toast(e.message, "error"));
  }, [load, toast]);

  async function save(part: "topups" | "experiments") {
    setBusy(true);
    try {
      await adminApi("/api/admin/pricing-lab", { method: "PUT", json: part === "topups" ? { topups } : { experiments: exp } });
      await load();
      toast(part === "topups" ? "Top-up packs saved" : "Price test saved");
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function mark(id: string, status: string) {
    try {
      await adminApi("/api/admin/pricing-lab", { method: "PATCH", json: { feedbackId: id, status } });
      setLab((l) => (l ? { ...l, cancels: { ...l.cancels, recent: l.cancels.recent.map((f) => (f.id === id ? { ...f, status } : f)) } } : l));
    } catch (e: any) {
      toast(e.message, "error");
    }
  }

  if (!lab || !topups || !exp) return <Card aria-busy="true"><CardTitle>Pricing lab</CardTitle><p className="text-[13px] text-muted-foreground">Loading…</p></Card>;
  const m = lab.metrics;
  const setPack = (i: number, p: Partial<TopUpPack>) => setTopups({ ...topups, packs: topups.packs.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const setVar = (i: number, p: Partial<ExperimentsConfig["price"]["variants"][number]>) => setExp({ price: { ...exp.price, variants: exp.price.variants.map((v, j) => (j === i ? { ...v, ...p } : v)) } });
  const maxReason = Math.max(1, ...lab.cancels.counts.map((c) => c.count));
  // Saved packs keep their id (bought packs point at it); only rows added here can set id and kind.
  const savedIds = new Set(lab.topups.packs.map((p) => p.id));
  const addPack = () => {
    let n = topups.packs.length + 1;
    while (topups.packs.some((p) => p.id === `pack-${n}`)) n++;
    setTopups({ ...topups, packs: [...topups.packs, { id: `pack-${n}`, kind: "ai", units: 10, priceMinor: 4900, prices: {}, days: 90, label: "", plans: [] }] });
  };
  const dropPack = (i: number) => setTopups({ ...topups, packs: topups.packs.filter((_, j) => j !== i) });
  const addVar = () => {
    const base = exp.price.variants[exp.price.variants.length - 1]?.priceMinor ?? 79900;
    setExp({ price: { ...exp.price, variants: [...exp.price.variants, { id: String.fromCharCode(65 + exp.price.variants.length), priceMinor: base, weight: 50 }] } });
  };
  const dropVar = (i: number) => setExp({ price: { ...exp.price, variants: exp.price.variants.filter((_, j) => j !== i) } });

  return (
    <div className="mt-6 flex flex-col gap-5">
      <Card aria-labelledby="lab-rule">
        <CardTitle hint="From the pricing strategy: keep four plans while 60-day free-to-paid is at least 4% and monthly churn is at most 6%." action={<Pill tone={!m.enoughData ? "muted" : m.keep ? "ok" : "bad"}>{!m.enoughData ? "Too early to call" : m.keep ? "Keep the structure" : "Rethink the plans"}</Pill>}>
          <span id="lab-rule">Decision rule</span>
        </CardTitle>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-secondary/40 p-4 hairline">
            <dt className="text-[12px] text-muted-foreground">Free to paid within 60 days</dt>
            <dd className="tabular mt-1 text-[1.6rem] font-semibold">{pct(m.freeToPaid60)} <span className="text-[13px] font-normal text-muted-foreground">target {pct(m.rule.freeToPaid60)}+</span></dd>
            <dd className="text-[12px] text-muted-foreground">{m.converted} of {m.cohort} people who signed up 60 to 120 days ago</dd>
          </div>
          <div className="rounded-2xl bg-secondary/40 p-4 hairline">
            <dt className="text-[12px] text-muted-foreground">Monthly churn</dt>
            <dd className="tabular mt-1 text-[1.6rem] font-semibold">{pct(m.churn)} <span className="text-[13px] font-normal text-muted-foreground">limit {pct(m.rule.churn)}</span></dd>
            <dd className="text-[12px] text-muted-foreground">{m.cancelled} of {m.liveThen} paid plans live 30 days ago were cancelled</dd>
          </div>
        </dl>
        {!m.enoughData && <p className="mt-3 text-[12.5px] text-muted-foreground">Needs about 100 signups in the cohort and 30 paid plans before these numbers settle.</p>}
      </Card>

      <Card aria-labelledby="lab-topups">
        <CardTitle hint="One-off packs on top of a plan: AI captions on more videos, X posts, an extra brand or seat. A pack is hidden from plans where it would add nothing. Units expire after the days set." action={<Button type="button" variant="lime" className="rounded-full" disabled={busy} onClick={() => save("topups")}>Save packs</Button>}>
          <span id="lab-topups">Top-ups</span>
        </CardTitle>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Switch label="Sell top-ups" hint="Shows the packs on the billing page" checked={topups.enabled} onChange={(v) => setTopups({ ...topups, enabled: v })} />
          <Switch label="Paid plans only" hint="Free upgrades instead of buying packs" checked={topups.paidOnly} onChange={(v) => setTopups({ ...topups, paidOnly: v })} />
        </div>
        <Table label="Top-up packs" head={["Pack", "Units", "Price (₹)", "USD / EUR / GBP", "Days", "Plans (blank = any)", ""]}>
          {topups.packs.map((p, i) => (
            <tr key={i}>
              <td>
                <Input aria-label={`${p.id} label`} value={p.label} placeholder="auto" onChange={(e) => setPack(i, { label: e.target.value })} />
                {savedIds.has(p.id) ? (
                  <span className="mt-1 block text-[11px] text-muted-foreground">{p.id} · {KIND_LABEL[p.kind]}</span>
                ) : (
                  <span className="mt-1 flex gap-1">
                    <Input aria-label={`New pack ${i + 1} id`} value={p.id} onChange={(e) => setPack(i, { id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30) })} className="h-9 w-28 text-[12px]" />
                    <select aria-label={`New pack ${i + 1} kind`} value={p.kind} onChange={(e) => setPack(i, { kind: e.target.value as TopUpKind })} className="h-9 min-h-[36px] rounded-xl bg-secondary px-2 text-[12px] hairline">
                      {TOPUP_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </select>
                  </span>
                )}
              </td>
              <td><Input aria-label={`${p.id} units`} type="number" min={1} value={p.units} onChange={(e) => setPack(i, { units: intIn(e.target.value, 1, 10_000) })} className="w-24" /></td>
              <td><Input aria-label={`${p.id} price in rupees`} type="number" min={1} value={p.priceMinor / 100} onChange={(e) => setPack(i, { priceMinor: intIn(e.target.value, 1, 100_000) * 100 })} className="w-28" /></td>
              <td>
                <span className="flex gap-1">
                  {FX.map((c) => (
                    <Input key={c} aria-label={`${p.id} price in ${c}`} inputMode="decimal" placeholder={c} value={p.prices[c] ? p.prices[c]! / 100 : ""} onChange={(e) => { const n = Math.round(Number(e.target.value) * 100); const prices = { ...p.prices }; if (n > 0) prices[c] = n; else delete prices[c]; setPack(i, { prices }); }} className="w-[4.5rem]" />
                  ))}
                </span>
              </td>
              <td><Input aria-label={`${p.id} days`} type="number" min={1} max={365} value={p.days} onChange={(e) => setPack(i, { days: intIn(e.target.value, 1, 365) })} className="w-20" /></td>
              <td><Input aria-label={`${p.id} plans`} value={p.plans.join(", ")} placeholder="any" onChange={(e) => setPack(i, { plans: e.target.value.split(",").map((s) => s.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean) })} /><span className="mt-1 block text-[11px] text-muted-foreground">Plan slugs, e.g. creator, pro-manager</span></td>
              <td><Button type="button" variant="ghost" size="sm" className="min-h-[44px] rounded-full" aria-label={`Remove ${p.id}`} onClick={() => dropPack(i)}>Remove</Button></td>
            </tr>
          ))}
        </Table>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="button" variant="subtle" className="min-h-[44px] rounded-full" disabled={topups.packs.length >= 12} onClick={addPack}>Add pack</Button>
          <span className="text-[12px] text-muted-foreground">Up to 12. Blank USD / EUR / GBP = converted from the rupee price. Removing a pack stops sales; packs already bought still count.</span>
        </div>
      </Card>

      <Card aria-labelledby="lab-exp">
        <CardTitle hint="Splits new checkouts for one plan between prices. A person always sees the same price. Change the name to start a fresh test." action={<Button type="button" variant="lime" className="rounded-full" disabled={busy} onClick={() => save("experiments")}>Save test</Button>}>
          <span id="lab-exp">Price test</span>
        </CardTitle>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-4"><Switch label="Run the test" hint={exp.price.enabled ? "Live: checkout uses the variant price" : "Off: everyone pays the plan price"} checked={exp.price.enabled} onChange={(v) => setExp({ price: { ...exp.price, enabled: v } })} /></div>
          <div><Label htmlFor="ex-name">Test name</Label><Input id="ex-name" value={exp.price.name} onChange={(e) => setExp({ price: { ...exp.price, name: e.target.value } })} /></div>
          <div><Label htmlFor="ex-plan">Plan slug</Label><Input id="ex-plan" value={exp.price.plan} onChange={(e) => setExp({ price: { ...exp.price, plan: e.target.value } })} /></div>
          <div><Label htmlFor="ex-cur">Currency</Label><Input id="ex-cur" value={exp.price.currency} onChange={(e) => setExp({ price: { ...exp.price, currency: e.target.value.toUpperCase().slice(0, 3) } })} /></div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {exp.price.variants.map((v, i) => (
            <fieldset key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2 rounded-2xl bg-secondary/40 p-3 hairline">
              <legend className="sr-only">Variant {v.id}</legend>
              <div><Label htmlFor={`ex-v${i}`}>Variant</Label><Input id={`ex-v${i}`} value={v.id} onChange={(e) => setVar(i, { id: e.target.value })} /></div>
              <div><Label htmlFor={`ex-p${i}`}>Price</Label><Input id={`ex-p${i}`} type="number" min={1} value={v.priceMinor / 100} onChange={(e) => setVar(i, { priceMinor: intIn(e.target.value, 1, 1_000_000) * 100 })} /></div>
              <div><Label htmlFor={`ex-w${i}`}>Weight</Label><Input id={`ex-w${i}`} type="number" min={0} max={100} value={v.weight} onChange={(e) => setVar(i, { weight: intIn(e.target.value, 0, 100) })} /></div>
              <Button type="button" variant="ghost" size="sm" className="min-h-[44px] rounded-full" aria-label={`Remove variant ${v.id}`} disabled={exp.price.variants.length <= 2} onClick={() => dropVar(i)}>Remove</Button>
            </fieldset>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="button" variant="subtle" className="min-h-[44px] rounded-full" disabled={exp.price.variants.length >= 4} onClick={addVar}>Add variant</Button>
          <span className="text-[12px] text-muted-foreground">2 to 4 variants. Prices are in the test currency. Weights set the split.</span>
        </div>
        <h3 className="mb-2 mt-5 text-[13px] font-semibold">Results: {lab.results.experiment}</h3>
        {lab.results.variants.some((v) => v.exposures) ? (
          <Table label="Price test results" head={["Variant", "Saw price", "Checkouts", "Paid", "Paid rate", "Revenue / visitor", "vs first"]}>
            {lab.results.variants.map((v, i) => (
              <tr key={v.variant}>
                <td className="font-medium">{v.variant}</td>
                <td className="tabular">{v.exposures}</td>
                <td className="tabular">{v.checkouts}</td>
                <td className="tabular">{v.paid}</td>
                <td className="tabular">{pct(v.rate)}</td>
                <td className="tabular">{money(Math.round(v.revenuePerVisitor), exp.price.currency)}</td>
                <td>{i === 0 ? <Pill>baseline</Pill> : <Pill tone={v.significant ? (v.z > 0 ? "ok" : "bad") : "muted"}>z {v.z}{v.significant ? " · real" : " · noise"}</Pill>}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty title="No data yet" body="Results appear once the test is on and people open checkout." />
        )}
      </Card>

      <Card aria-labelledby="lab-survey">
        <CardTitle hint="Van Westendorp: where 'too cheap' meets 'too expensive' (optimal) and the acceptable range around it. Under 30 answers is a hint, not a result.">
          <span id="lab-survey">Price survey ({lab.survey.total} answers)</span>
        </CardTitle>
        {lab.survey.groups.length ? (
          <Table label="Survey results" head={["Plan", "Answers", "Lowest OK", "Optimal", "Indifferent", "Highest OK"]}>
            {lab.survey.groups.map((g) => (
              <tr key={`${g.plan}-${g.currency}`}>
                <td className="font-medium">{g.plan} <span className="text-muted-foreground">{g.currency}</span></td>
                <td className="tabular">{g.n}{g.n < 30 && <span className="ml-1 text-[11px] text-muted-foreground">(few)</span>}</td>
                <td className="tabular">{money(g.pmc, g.currency)}</td>
                <td className="tabular font-semibold">{money(g.opp, g.currency)}</td>
                <td className="tabular">{money(g.ipp, g.currency)}</td>
                <td className="tabular">{money(g.pme, g.currency)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty title="No answers yet" body="The billing page asks signed-in people four price questions, once each." />
        )}
      </Card>

      <Card aria-labelledby="lab-cancel">
        <CardTitle hint="Why people cancel (last 90 days), and who agreed to a 15-minute call.">
          <span id="lab-cancel">Cancel reasons</span>
        </CardTitle>
        <ul className="mb-5 grid gap-2">
          {lab.cancels.counts.map((c) => (
            <li key={c.reason} className="grid grid-cols-[12rem_minmax(0,1fr)_2.5rem] items-center gap-3 text-[13px]">
              <span>{CANCEL_REASON_LABEL[c.reason]}</span>
              <span className="h-2.5 rounded-full bg-secondary" aria-hidden="true"><span className="block h-full rounded-full bg-lime" style={{ width: `${(c.count / maxReason) * 100}%` }} /></span>
              <span className="tabular text-right">{c.count}</span>
            </li>
          ))}
        </ul>
        {lab.cancels.recent.length ? (
          <Table label="Recent cancellations" lead={1} head={["When", "Who", "Plan", "Reason", "Note", "Follow-up"]}>
            {lab.cancels.recent.map((f) => (
              <tr key={f.id}>
                <td className="whitespace-nowrap">{fmtDate(f.createdAt)}</td>
                <td><span className="block font-medium">{f.name}</span><span className="text-[12px] text-muted-foreground">{f.email}</span></td>
                <td>{f.planSlug}</td>
                <td>{CANCEL_REASON_LABEL[f.reason] ?? f.reason}</td>
                <td className="max-w-[18rem] text-[12.5px]">{f.detail || <span className="text-muted-foreground">none</span>}</td>
                <td>
                  {f.interview ? (
                    <select aria-label={`Follow-up with ${f.name}`} value={f.status} onChange={(e) => mark(f.id, e.target.value)} className="min-h-[44px] rounded-xl bg-secondary px-3 text-[13px] hairline">
                      <option value="new">Call: to do</option>
                      <option value="contacted">Contacted</option>
                      <option value="done">Done</option>
                    </select>
                  ) : (
                    <span className="text-[12px] text-muted-foreground">No call</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty title="No cancellations yet" />
        )}
      </Card>
    </div>
  );
}
