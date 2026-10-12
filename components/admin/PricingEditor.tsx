"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ExternalLink, Plus, Sparkles, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { adminApi } from "@/lib/client/admin-api";
import { CURRENCIES, priceLabel, type PublicPlan } from "@/lib/billing/money";
import { localPrice } from "@/lib/billing/currency";
import { cn } from "@/lib/utils";
import { Pill } from "./ui";

type Plan = PublicPlan & { subscribers: number; locked: boolean };
type Draft = { name: string; slug: string; price: string; currency: string; interval: string; note: string; features: string; state: PublicPlan["state"]; highlight: boolean; sortOrder: number; prices: Record<string, string>; postLimit: number; aiCaptions: boolean; seats: number };

const toDraft = (p: Plan): Draft => ({
  name: p.name, slug: p.slug, price: String(p.priceMinor / 100), currency: p.currency, interval: p.interval, note: p.note, features: p.features.join("\n"), state: p.state, highlight: p.highlight, sortOrder: p.sortOrder,
  prices: Object.fromEntries(Object.entries(p.prices ?? {}).map(([k, v]) => [k, String((v as number) / 100)])),
  postLimit: p.postLimit ?? 0, aiCaptions: p.aiCaptions ?? true, seats: p.seats ?? 0,
});
const BLANK: Draft = { name: "", slug: "", price: "0", currency: "INR", interval: "month", note: "", features: "", state: "soon", highlight: false, sortOrder: 9, prices: {}, postLimit: 0, aiCaptions: true, seats: 0 };

const toMinor = (s: string) => {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

function parse(d: Draft) {
  const n = Number(d.price.replace(/,/g, ""));
  const prices: Record<string, number> = {};
  for (const [k, v] of Object.entries(d.prices)) if (v.trim() && k !== d.currency) prices[k] = toMinor(v);
  return {
    name: d.name.trim(),
    slug: d.slug.trim() || undefined,
    priceMinor: Number.isFinite(n) ? Math.round(n * 100) : NaN,
    currency: d.currency,
    interval: d.interval,
    note: d.note.trim(),
    features: d.features.split("\n").map((f) => f.trim()).filter(Boolean),
    state: d.state,
    highlight: d.highlight,
    sortOrder: d.sortOrder,
    prices,
    postLimit: d.postLimit,
    aiCaptions: d.aiCaptions,
    seats: d.seats,
  };
}

/** Exact price per currency. Blank = converted automatically, shown as the placeholder. */
function LocalPrices({ d, parsed, onChange }: { d: Draft; parsed: ReturnType<typeof parse>; onChange: (c: string, v: string) => void }) {
  const others = CURRENCIES.filter((c) => c !== d.currency);
  const free = !Number.isFinite(parsed.priceMinor) || parsed.priceMinor <= 0;
  return (
    <fieldset className="sm:col-span-2 rounded-2xl bg-secondary/30 p-4 hairline">
      <legend className="px-1 text-[14px] font-medium">Local prices</legend>
      <p className="mb-3 text-[12px] text-muted-foreground">Visitors see the price in their own currency, picked from where they are. Leave a box blank to convert from {d.currency} automatically (the grey number); type a price to set it exactly.</p>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {others.map((c) => {
          const auto = free ? "0" : String(localPrice({ priceMinor: parsed.priceMinor, currency: d.currency }, c).priceMinor / 100);
          return (
            <div key={c}>
              <Label htmlFor={`pl-px-${c}`} className="text-[12px]">{c}</Label>
              <Input id={`pl-px-${c}`} inputMode="decimal" disabled={free} value={d.prices[c] ?? ""} placeholder={auto} onChange={(e) => onChange(c, e.target.value.replace(/[^\d.,]/g, ""))} className="tabular h-11 text-[15px]" />
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full rounded-2xl bg-secondary/60 p-1 hairline">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={cn("h-10 flex-1 rounded-xl px-3 text-[13px] font-semibold transition-all duration-300", value === o.value ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Same visual as the marketing pricing card, so what you see is what goes live. */
function Preview({ d }: { d: ReturnType<typeof parse> }) {
  const live = d.state === "available";
  const price = Number.isFinite(d.priceMinor) ? priceLabel({ priceMinor: d.priceMinor, currency: d.currency, interval: d.interval, state: d.state }) : "-";
  return (
    <article className={cn("flex h-full flex-col rounded-[1.75rem] p-7 transition-all duration-500", d.highlight ? "border-2 border-lime bg-lime/[0.07]" : "border border-border bg-card", d.state === "hidden" && "opacity-50")}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xl font-semibold tracking-tight">{d.name || "Plan name"}</h3>
        {d.highlight && live && <span className="rounded-full bg-lime px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-[hsl(var(--lime-foreground))]">Popular</span>}
        {d.state === "soon" && <span className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Soon</span>}
      </div>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.p key={price} initial={{ opacity: 0, y: 10, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -10, filter: "blur(4px)" }} transition={{ duration: 0.35 }} className={cn("mt-5 text-[1.6rem] font-semibold tracking-tightest", live ? "text-lime-ink" : "text-muted-foreground")}>
          {price}
        </motion.p>
      </AnimatePresence>
      <p className="mt-1 text-sm text-muted-foreground">{d.note || "\u00a0"}</p>
      <ul className="mt-6 flex flex-1 flex-col gap-2.5">
        {d.features.map((b, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[14.5px] leading-snug">
            <Check className={cn("mt-0.5 h-4 w-4 shrink-0", live ? "text-lime-ink" : "text-muted-foreground")} aria-hidden />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <span className={cn("mt-7 inline-flex h-11 items-center justify-center rounded-full px-6 text-sm font-semibold", live ? "bg-lime text-[hsl(var(--lime-foreground))]" : "hairline text-muted-foreground")}>
        {live ? (d.priceMinor > 0 ? `Get ${d.name || "plan"}` : "Start creating") : d.state === "soon" ? "Not on sale yet" : "Hidden from the site"}
      </span>
    </article>
  );
}

export function PricingEditor({ initial }: { initial: Plan[] }) {
  const [plans, setPlans] = useState(initial);
  const [sel, setSel] = useState<string>(initial.find((p) => p.highlight)?.id ?? initial[0]?.id ?? "new");
  const [draft, setDraft] = useState<Draft>(() => (initial[0] ? toDraft(initial.find((p) => p.id === sel) ?? initial[0]) : BLANK));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const current = plans.find((p) => p.id === sel);
  const parsed = useMemo(() => parse(draft), [draft]);
  const dirty = current ? JSON.stringify(toDraft(current)) !== JSON.stringify(draft) : true;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const pick = (id: string) => {
    if (dirty && sel !== id && !confirm("Discard unsaved changes to this plan?")) return;
    setSel(id);
    setError(null);
    const p = plans.find((x) => x.id === id);
    setDraft(p ? toDraft(p) : BLANK);
  };

  async function save() {
    if (!parsed.name) return setError("Give the plan a name.");
    if (!Number.isFinite(parsed.priceMinor) || parsed.priceMinor < 0) return setError("Price must be a number, like 499 or 4.99.");
    const badLocal = Object.entries(parsed.prices).find(([, v]) => !Number.isFinite(v) || v <= 0);
    if (badLocal) return setError(`The ${badLocal[0]} price must be a number above zero, or blank to convert automatically.`);
    setBusy(true);
    setError(null);
    try {
      const body = { ...parsed, ...(current?.locked ? { slug: undefined } : {}) };
      const r = current
        ? await adminApi<{ plan: any }>(`/api/admin/plans/${current.id}`, { method: "PATCH", json: body })
        : await adminApi<{ plan: any }>("/api/admin/plans", { method: "POST", json: body });
      const fresh = await adminApi<{ plans: (PublicPlan & { subscribers: number })[] }>("/api/admin/plans");
      const next = fresh.plans.map((p) => ({ ...p, locked: plans.find((o) => o.id === p.id)?.locked ?? false }));
      setPlans(next);
      setSel(r.plan.id);
      const saved = next.find((p) => p.id === r.plan.id);
      if (saved) setDraft(toDraft(saved));
      toast(parsed.state === "available" ? `${parsed.name} is live on the site at ${priceLabel(parsed as any)}` : `${parsed.name} saved`);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!current) return;
    setBusy(true);
    try {
      await adminApi(`/api/admin/plans/${current.id}`, { method: "DELETE" });
      const next = plans.filter((p) => p.id !== current.id);
      setPlans(next);
      setSel(next[0]?.id ?? "new");
      setDraft(next[0] ? toDraft(next[0]) : BLANK);
      toast(`${current.name} deleted`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
      setDel(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)_340px]">
      {/* plan list */}
      <div className="flex flex-col gap-2">
        {plans.map((p) => (
          <button key={p.id} type="button" onClick={() => pick(p.id)} aria-pressed={sel === p.id} className={cn("group flex items-center gap-3 rounded-[20px] p-3.5 text-left transition-all duration-300 hairline", sel === p.id ? "bg-card shadow-[0_10px_30px_-18px_hsl(var(--foreground)/0.4)] ring-2 ring-lime" : "hover:bg-card/70")}>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 font-semibold">{p.name}{p.highlight && <Sparkles className="h-3.5 w-3.5 text-lime-ink" aria-label="highlighted" />}</span>
              <span className="block text-[12.5px] text-muted-foreground">{priceLabel(p)}</span>
            </span>
            <span className="flex flex-col items-end gap-1">
              <Pill tone={p.state === "available" ? "ok" : p.state === "soon" ? "warn" : "muted"}>{p.state === "available" ? "Live" : p.state === "soon" ? "Soon" : "Hidden"}</Pill>
              {p.subscribers > 0 && <span className="flex items-center gap-1 text-[11.5px] text-muted-foreground"><Users className="h-3 w-3" aria-hidden />{p.subscribers}</span>}
            </span>
          </button>
        ))}
        <button type="button" onClick={() => pick("new")} aria-pressed={sel === "new"} className={cn("flex h-12 items-center justify-center gap-2 rounded-[20px] border border-dashed border-border text-[13.5px] font-medium text-muted-foreground transition-colors hover:border-lime hover:text-foreground", sel === "new" && "border-lime text-foreground")}>
          <Plus className="h-4 w-4" aria-hidden /> Add a plan
        </button>
        <a href="/#pricing" target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1.5 self-start rounded-full px-3 py-2 text-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground">
          <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open live pricing
        </a>
      </div>

      {/* form */}
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="rounded-[24px] bg-card p-5 hairline sm:p-6" aria-label={current ? `Edit ${current.name}` : "New plan"}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="pl-name">Name</Label>
            <Input id="pl-name" value={draft.name} onChange={(e) => set("name", e.target.value)} maxLength={40} />
          </div>
          <div>
            <Label htmlFor="pl-slug">Slug <span className="text-[11.5px]">{current?.locked ? "locked: has payments" : "used in links"}</span></Label>
            <Input id="pl-slug" value={draft.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} disabled={current?.locked} placeholder="auto from name" className="font-mono text-[14px]" />
          </div>
          <div>
            <Label htmlFor="pl-price">Price</Label>
            <div className="flex gap-2">
              <select aria-label="Currency" value={draft.currency} onChange={(e) => set("currency", e.target.value)} className="h-12 rounded-2xl bg-secondary/60 px-3 text-[14px] font-semibold hairline">
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
              <Input id="pl-price" inputMode="decimal" value={draft.price} onChange={(e) => set("price", e.target.value.replace(/[^\d.,]/g, ""))} className="tabular text-[17px] font-semibold" aria-describedby="pl-price-hint" />
            </div>
            <p id="pl-price-hint" className="mt-1.5 text-[12px] text-muted-foreground">0 makes it free. Tax is added on the invoice from Integrations.</p>
          </div>
          <div>
            <Label>Billing</Label>
            <Seg label="Billing interval" value={draft.interval as "month" | "year"} onChange={(v) => set("interval", v)} options={[{ value: "month", label: "Monthly" }, { value: "year", label: "Yearly" }]} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="pl-note">Tagline</Label>
            <Input id="pl-note" value={draft.note} onChange={(e) => set("note", e.target.value)} maxLength={80} placeholder="For one creator going faster" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="pl-feat">Features <span className="text-[11.5px]">one per line · {parsed.features.length}/12</span></Label>
            <Textarea id="pl-feat" rows={6} value={draft.features} onChange={(e) => set("features", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label>Visibility</Label>
            <Seg label="Visibility" value={draft.state} onChange={(v) => set("state", v)} options={[{ value: "available", label: "On sale" }, { value: "soon", label: "Coming soon" }, { value: "hidden", label: "Hidden" }]} />
          </div>
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl bg-secondary/40 px-4 py-3 hairline sm:col-span-2">
            <span>
              <span className="block text-[14px] font-medium">Highlight as most popular</span>
              <span className="block text-[12px] text-muted-foreground">Only one plan can be highlighted.</span>
            </span>
            <input type="checkbox" role="switch" checked={draft.highlight} onChange={(e) => set("highlight", e.target.checked)} className="peer sr-only" />
            <span aria-hidden className="relative h-7 w-12 rounded-full bg-muted transition-colors peer-checked:bg-lime peer-focus-visible:outline peer-focus-visible:outline-2 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-background after:shadow after:transition-transform after:duration-300 peer-checked:after:translate-x-5" />
          </label>
          <LocalPrices d={draft} parsed={parsed} onChange={(c, v) => setDraft((x) => ({ ...x, prices: { ...x.prices, [c]: v } }))} />
          <fieldset className="sm:col-span-2 grid gap-3 rounded-2xl bg-secondary/30 p-4 hairline sm:grid-cols-3">
            <legend className="px-1 text-[14px] font-medium">Plan limits</legend>
            <div>
              <Label htmlFor="pl-posts" className="text-[12px]">Posts per month</Label>
              <Input id="pl-posts" type="number" min={0} max={100000} value={draft.postLimit} onChange={(e) => set("postLimit", Math.max(0, Math.min(100000, Math.floor(Number(e.target.value) || 0))))} aria-describedby="pl-posts-hint" className="h-11" />
              <p id="pl-posts-hint" className="mt-1 text-[11.5px] text-muted-foreground">0 = unlimited</p>
            </div>
            <div>
              <Label htmlFor="pl-seats" className="text-[12px]">Team seats</Label>
              <Input id="pl-seats" type="number" min={0} max={50} value={draft.seats} onChange={(e) => set("seats", Math.max(0, Math.min(50, Math.floor(Number(e.target.value) || 0))))} aria-describedby="pl-seats-hint" className="h-11" />
              <p id="pl-seats-hint" className="mt-1 text-[11.5px] text-muted-foreground">People besides the owner</p>
            </div>
            <label className="flex cursor-pointer items-center justify-between gap-3 self-start rounded-2xl bg-background/60 px-3 py-2.5 hairline sm:mt-6">
              <span className="text-[13px] font-medium">AI captions</span>
              <input type="checkbox" role="switch" checked={draft.aiCaptions} onChange={(e) => set("aiCaptions", e.target.checked)} className="peer sr-only" />
              <span aria-hidden className="relative h-7 w-12 shrink-0 rounded-full bg-muted transition-colors peer-checked:bg-lime peer-focus-visible:outline peer-focus-visible:outline-2 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-background after:shadow after:transition-transform after:duration-300 peer-checked:after:translate-x-5" />
            </label>
          </fieldset>
          <div>
            <Label htmlFor="pl-order">Order on the page</Label>
            <Input id="pl-order" type="number" min={0} max={99} value={draft.sortOrder} onChange={(e) => set("sortOrder", Math.max(0, Math.min(99, Number(e.target.value) || 0)))} />
          </div>
        </div>

        {current && current.subscribers > 0 && parsed.priceMinor !== current.priceMinor && (
          <p className="mt-4 rounded-2xl bg-accent/10 px-4 py-3 text-[13px]">{current.subscribers} active subscriber{current.subscribers === 1 ? "" : "s"} keep{current.subscribers === 1 ? "s" : ""} {priceLabel(current)} until they change plan. New customers pay {priceLabel(parsed as any)}.</p>
        )}
        <div className="liquid-panel" data-open={!!error}>
          <div><p role="alert" className="liquid-inner mt-4 rounded-2xl bg-destructive/10 px-4 py-3 text-[13.5px] text-destructive">{error}</p></div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button type="submit" variant="lime" disabled={busy || (!dirty && !!current)}>
            {busy ? "Saving…" : current ? (dirty ? "Save & publish" : "Saved") : "Create plan"}
          </Button>
          {current && dirty && <Button type="button" variant="ghost" onClick={() => setDraft(toDraft(current))}>Undo changes</Button>}
          {current && <Button type="button" variant="danger" className="ml-auto" onClick={() => setDel(true)} disabled={busy}><Trash2 className="h-4 w-4" aria-hidden />Delete</Button>}
        </div>
      </form>

      {/* preview */}
      <div className="xl:sticky xl:top-20 xl:self-start">
        <p className="eyebrow mb-2 text-[11px]">Live preview</p>
        <Preview d={parsed} />
      </div>

      <ConfirmDialog open={del} onOpenChange={setDel} title={`Delete ${current?.name}?`} body="Only possible for plans nobody has paid for. If people have, set it to Hidden instead." confirmLabel="Delete plan" busy={busy} onConfirm={remove} />
    </div>
  );
}
