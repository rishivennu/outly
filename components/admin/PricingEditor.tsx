"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { adminApi } from "@/lib/client/admin-api";
import { CURRENCIES, formatMoney, priceLabel, type PublicPlan } from "@/lib/billing/money";
import { localPrice } from "@/lib/billing/currency";
import { cn } from "@/lib/utils";
import { DotText } from "@/components/brand/DotText";
import { PlanCardView } from "@/components/billing/PlanCardView";
import { CycleSwitch } from "@/components/billing/CycleSwitch";
import { CARD_STYLES, CARD_STYLE_META, type CardStyle, type PricingDisplay } from "@/lib/billing/display";
import { hasYearly, yearlyBase, yearlySaving, type Cycle } from "@/lib/billing/cycle";

type Plan = PublicPlan & { subscribers: number; locked: boolean };
type Draft = { name: string; slug: string; price: string; currency: string; interval: string; note: string; features: string; state: PublicPlan["state"]; highlight: boolean; sortOrder: number; prices: Record<string, string>; yearly: string; postLimit: number; aiCaptions: boolean; seats: number; postPeriod: "week" | "month"; maxUploadMb: number; replyLimit: number; captionVideos: number; burnCaptions: boolean; accountLimit: number };

const toDraft = (p: Plan): Draft => ({
  name: p.name, slug: p.slug, price: String(p.priceMinor / 100), currency: p.currency, interval: p.interval, note: p.note, features: p.features.join("\n"), state: p.state, highlight: p.highlight, sortOrder: p.sortOrder,
  prices: Object.fromEntries(Object.entries(p.prices ?? {}).map(([k, v]) => [k, String((v as number) / 100)])),
  yearly: p.yearlyMinor ? String(p.yearlyMinor / 100) : "",
  postLimit: p.postLimit ?? 0, aiCaptions: p.aiCaptions ?? true, seats: p.seats ?? 0,
  postPeriod: p.postPeriod === "week" ? "week" : "month", maxUploadMb: p.maxUploadMb ?? 0, replyLimit: p.replyLimit ?? 0, captionVideos: p.captionVideos ?? 0, burnCaptions: p.burnCaptions ?? true, accountLimit: p.accountLimit ?? 0,
});
const BLANK: Draft = { name: "", slug: "", price: "0", currency: "INR", interval: "month", note: "", features: "", state: "soon", highlight: false, sortOrder: 9, prices: {}, yearly: "", postLimit: 0, aiCaptions: true, seats: 0, postPeriod: "month", maxUploadMb: 0, replyLimit: 0, captionVideos: 0, burnCaptions: true, accountLimit: 0 };

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
    yearlyMinor: d.yearly.trim() ? toMinor(d.yearly) : 0,
    postLimit: d.postLimit,
    aiCaptions: d.aiCaptions,
    seats: d.seats,
    postPeriod: d.postPeriod,
    maxUploadMb: d.maxUploadMb,
    replyLimit: d.replyLimit,
    captionVideos: d.captionVideos,
    burnCaptions: d.burnCaptions,
    accountLimit: d.accountLimit,
  };
}

/** Exact price per currency. Blank = converted automatically, shown as the placeholder. */
function LocalPrices({ d, parsed, onChange }: { d: Draft; parsed: ReturnType<typeof parse>; onChange: (c: string, v: string) => void }) {
  const others = CURRENCIES.filter((c) => c !== d.currency);
  const free = !Number.isFinite(parsed.priceMinor) || parsed.priceMinor <= 0;
  return (
    <fieldset className="sm:col-span-2">
      <legend className="text-[14px] font-medium">Local prices</legend>
      <p className="mb-3 mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
        {free ? "A free plan is free everywhere." : `Visitors see their own currency. Leave a box blank to convert from ${d.currency} (the grey number), or type a price to set it exactly.`}
      </p>
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
    <div role="radiogroup" aria-label={label} className="inline-flex w-full rounded-full bg-secondary/60 p-1 hairline">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={cn("h-10 flex-1 rounded-full px-3 text-[13px] font-semibold transition-all duration-300", value === o.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-[3.25rem] cursor-pointer items-center justify-between gap-3 rounded-2xl bg-secondary/40 px-4 py-2.5 hairline">
      <span className="min-w-0">
        <span className="block text-[14px] font-medium">{label}</span>
        {hint && <span className="block text-[12px] text-muted-foreground">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span aria-hidden className="relative h-7 w-12 shrink-0 rounded-full bg-muted transition-colors peer-checked:bg-lime peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-background after:shadow after:transition-transform after:duration-300 peer-checked:after:translate-x-5" />
    </label>
  );
}

/** One numbered group of the form, drawn as a Live Activity inner box. */
function Section({ n, title, hint, children }: { n: string; title: string; hint?: string; children: React.ReactNode }) {
  const id = `pl-sec-${n}`;
  return (
    <section aria-labelledby={id} className="la-box relative rounded-[1.5rem] p-4 sm:p-5">
      <div className="mb-4 flex items-baseline gap-3">
        <span className="tabular text-[11px] font-bold uppercase tracking-[0.12em] la-accent" aria-hidden="true">{n}</span>
        <h2 id={id} className="text-[15px] font-semibold leading-tight">{title}</h2>
        {hint && <span className="ml-auto text-[12px] la-mute">{hint}</span>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

const STATE: Record<PublicPlan["state"], { label: string; note: string }> = {
  available: { label: "On sale", note: "Live on the site" },
  soon: { label: "Coming soon", note: "Shown, not on sale" },
  hidden: { label: "Hidden", note: "Not on the site" },
};

/** A plan in the rail: the same Live Activity card as the posting screen, with the plan name in dot letters. */
function PlanCard({ p, on, onPick }: { p: Plan; on: boolean; onPick: () => void }) {
  const live = p.state === "available";
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onPick}
        aria-pressed={on}
        aria-label={`${p.name}, ${priceLabel(p)}, ${STATE[p.state].label}${p.subscribers ? `, ${p.subscribers} active` : ""}`}
        className={cn(
          "la-card la-themed relative flex h-full w-full flex-col overflow-hidden rounded-[1.75rem] p-4 text-left transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[hsl(var(--ring))] motion-reduce:transition-none motion-reduce:hover:translate-y-0",
          live && "la-live",
          on && "ring-2 ring-lime ring-offset-2 ring-offset-background",
        )}
      >
        <span className="la-grid rounded-[inherit]" aria-hidden="true" />
        <span className="relative flex items-start justify-between gap-2" aria-hidden="true">
          <DotText text={p.name || "PLAN"} className="h-7 max-w-full" />
          {p.highlight && <Sparkles className="mt-1 h-4 w-4 shrink-0 la-accent" />}
        </span>
        <span className="relative mt-3 grid grid-cols-2 gap-3" aria-hidden="true">
          <span className="min-w-0">
            <span className="block truncate font-semibold leading-tight tabular">{priceLabel(p)}</span>
            <span className="mt-1 block text-[11px] font-semibold uppercase tracking-[0.08em] la-mute">{p.priceMinor === 0 ? "Free" : p.interval === "year" ? "Yearly" : "Monthly"}</span>
          </span>
          <span className="min-w-0">
            <span className="block font-semibold leading-tight tabular">{p.subscribers}</span>
            <span className="mt-1 block text-[11px] font-semibold uppercase tracking-[0.08em] la-mute">Active</span>
          </span>
        </span>
        <span className="la-box relative mt-3 flex items-center justify-between gap-2 rounded-[1.1rem] px-3.5 py-2.5" aria-hidden="true">
          <span className="text-[14px] font-semibold">{STATE[p.state].label}</span>
          <span className={cn("text-[10.5px] font-bold uppercase tracking-[0.1em]", live ? "la-accent" : "la-mute")}>{STATE[p.state].note}</span>
        </span>
      </button>
    </li>
  );
}

/** Same visual as the marketing pricing card, so what you see is what goes live. */
function Preview({ d, variant, cycle, freeMonths }: { d: ReturnType<typeof parse>; variant: CardStyle; cycle: Cycle; freeMonths: number }) {
  const live = d.state === "available";
  const ok = Number.isFinite(d.priceMinor) && Number.isFinite(d.yearlyMinor);
  const yearly = cycle === "year" && ok && hasYearly(d, true) ? yearlyBase(d, freeMonths) : 0;
  const price = !ok ? "-" : yearly ? `${formatMoney(yearly, d.currency)}/yr` : priceLabel({ priceMinor: d.priceMinor, currency: d.currency, interval: d.interval, state: d.state });
  return (
    <PlanCardView
      variant={variant}
      save={yearly ? yearlySaving(d.priceMinor, yearly) : 0}
      name={d.name}
      note={d.note}
      priceMinor={yearly || d.priceMinor}
      interval={yearly ? "year" : d.interval}
      state={d.state}
      features={d.features}
      featured={d.highlight}
      className={d.state === "hidden" ? "opacity-50" : undefined}
      price={
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={price} className="block" initial={{ opacity: 0, y: 10, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -10, filter: "blur(4px)" }} transition={{ duration: 0.35 }}>
            {price}
          </motion.span>
        </AnimatePresence>
      }
      cta={
        <span className={cn("inline-flex h-12 items-center justify-center rounded-full px-6 text-sm font-semibold", live ? (variant === "bold" && d.highlight ? "bg-[#0b0b0d] text-white" : "lime-glow bg-lime text-[hsl(var(--lime-foreground))]") : variant === "live" ? "la-box la-mute" : "border border-border text-muted-foreground")}>
          {live ? (d.priceMinor > 0 ? `Choose ${d.name || "plan"}${yearly ? " yearly" : ""}` : "Start creating") : d.state === "soon" ? "Not on sale yet" : "Hidden from the site"}
        </span>
      }
    />
  );
}

const MINI: Record<CardStyle, string> = {
  live: "la-card la-themed pc-live pc-hot la-live",
  classic: "border-2 border-lime bg-lime/[0.07]",
  glass: "pc-glass pc-hot",
  bold: "pc-bold pc-hot",
};

/** A thumbnail of each card style, drawn with the real style classes so it matches the site. */
function MiniCard({ v }: { v: CardStyle }) {
  return (
    <span className={cn("relative flex h-[5.5rem] flex-col overflow-hidden rounded-2xl p-3", MINI[v])} aria-hidden="true">
      {v === "live" && <span className="la-grid rounded-[inherit]" />}
      <span className="relative block h-2 w-10 rounded-full bg-current opacity-70" />
      <span className={cn("relative mt-2 block h-3.5 w-16 rounded-md", v === "bold" ? "bg-[#0b0b0d]" : v === "live" ? "la-box" : "bg-current opacity-25")} />
      <span className={cn("relative mt-auto block h-3 w-full rounded-full", v === "bold" ? "bg-[#0b0b0d]" : "bg-lime")} />
    </span>
  );
}

/** Card style + yearly billing. Applies to the landing page, billing page and this preview; saved on each change. */
function DisplayPanel({ value, onChange }: { value: PricingDisplay; onChange: (d: PricingDisplay) => void }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function save(patch: Partial<PricingDisplay>) {
    const before = value;
    onChange({ ...value, ...patch });
    setBusy(true);
    try {
      const r = await adminApi<{ display: PricingDisplay }>("/api/admin/pricing-display", { method: "PUT", json: patch });
      onChange(r.display);
      toast(patch.cardStyle ? `${CARD_STYLE_META[r.display.cardStyle].label} cards are live on the site` : "Pricing updated on the site");
      router.refresh();
    } catch (e: any) {
      onChange(before);
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="pc-style-h" className="la-card la-themed relative overflow-hidden rounded-[2rem] p-4 sm:p-5" aria-busy={busy || undefined}>
      <span className="la-grid rounded-[inherit]" aria-hidden="true" />
      <div className="relative mb-4 flex flex-wrap items-baseline gap-3">
        <h2 id="pc-style-h" className="text-[15px] font-semibold">Card style and billing</h2>
        <span className="text-[12px] la-mute">Changes the landing page, billing page and the preview below, the moment you click.</span>
      </div>
      <div role="radiogroup" aria-label="Pricing card style" className="relative grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {CARD_STYLES.map((v) => {
          const on = value.cardStyle === v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy}
              onClick={() => !on && save({ cardStyle: v })}
              className={cn(
                "la-box relative flex flex-col gap-3 rounded-[1.4rem] p-3 text-left transition-[box-shadow,transform] duration-300 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[hsl(var(--ring))] disabled:cursor-progress motion-reduce:transition-none motion-reduce:hover:translate-y-0",
              )}
            >
              {on && <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[1.4rem] ring-2 ring-inset ring-[hsl(var(--lime-ink))] dark:ring-lime" />}
              <MiniCard v={v} />
              <span className="px-1 pb-1">
                <span className="flex items-center gap-2 text-[14px] font-semibold">
                  {CARD_STYLE_META[v].label}
                  {on && <span className="rounded-full bg-lime px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-[hsl(var(--lime-foreground))]">Live</span>}
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug la-mute">{CARD_STYLE_META[v].hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="relative mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <Toggle label="Offer yearly billing" hint="Adds a Monthly / Yearly switch above the cards and at checkout." checked={value.yearly} onChange={(v) => save({ yearly: v })} />
        <div>
          <Label htmlFor="pc-free-months">Months free on yearly</Label>
          <select
            id="pc-free-months"
            value={value.freeMonths}
            disabled={busy || !value.yearly}
            onChange={(e) => save({ freeMonths: Number(e.target.value) })}
            className="h-12 w-full rounded-2xl bg-secondary/60 px-3 text-[14px] font-semibold hairline disabled:opacity-60"
          >
            {[0, 1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>{n === 0 ? "None (12 x monthly)" : `${n} month${n === 1 ? "" : "s"} (pay ${12 - n})`}</option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}

/** What saving does, in plain words, from facts on screen only. */
function Impact({ current, parsed }: { current?: Plan; parsed: ReturnType<typeof parse> }) {
  const ok = Number.isFinite(parsed.priceMinor);
  const price = ok ? priceLabel(parsed as any) : "-";
  const exact = Object.keys(parsed.prices).length;
  const auto = CURRENCIES.length - 1 - exact;
  const rows: { k: string; v: React.ReactNode; warn?: boolean }[] = [
    { k: "On the site", v: parsed.state === "available" ? `On sale at ${price}` : parsed.state === "soon" ? "Shown as coming soon" : "Not shown" },
    { k: "Other currencies", v: parsed.priceMinor > 0 ? `${exact} set by hand, ${auto} converted from ${parsed.currency}` : "Free everywhere" },
  ];
  if (current && current.subscribers > 0) {
    const changed = parsed.priceMinor !== current.priceMinor || parsed.currency !== current.currency || parsed.interval !== current.interval;
    rows.push({
      k: current.subscribers === 1 ? "1 subscriber" : `${current.subscribers} subscribers`,
      v: changed ? `Keep ${priceLabel(current)} until they change plan. New customers pay ${price}.` : "Nothing changes for them.",
      warn: changed,
    });
  }
  return (
    <div className="la-card la-themed relative mt-4 overflow-hidden rounded-[1.75rem] p-4" aria-live="polite">
      <span className="la-grid rounded-[inherit]" aria-hidden="true" />
      <p className="relative text-[11px] font-bold uppercase tracking-[0.12em] la-mute">When you save</p>
      <dl className="relative mt-3 grid gap-2">
        {rows.map((r) => (
          <div key={r.k} className="la-box rounded-[1.1rem] px-3.5 py-2.5">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] la-mute">{r.k}</dt>
            <dd className={cn("mt-0.5 text-[13.5px] font-medium leading-snug", r.warn && "la-warn")}>{r.v}</dd>
          </div>
        ))}
      </dl>
      <p className="relative mt-3 text-[12px] leading-relaxed la-mute">The website, checkout and billing page use it on the very next request.</p>
    </div>
  );
}

export function PricingEditor({ initial, display: initialDisplay }: { initial: Plan[]; display: PricingDisplay }) {
  const [plans, setPlans] = useState(initial);
  const [display, setDisplay] = useState(initialDisplay);
  const [cycle, setCycle] = useState<Cycle>("month");
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
    if (!Number.isFinite(parsed.yearlyMinor) || parsed.yearlyMinor < 0) return setError("Yearly price must be a number, or blank for the automatic one.");
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
    <div className="flex flex-col gap-5">
      <DisplayPanel value={display} onChange={setDisplay} />
      {/* plan rail */}
      <ul aria-label="Plans" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => (
          <PlanCard key={p.id} p={p} on={sel === p.id} onPick={() => pick(p.id)} />
        ))}
        <li className="min-w-0">
          <button
            type="button"
            onClick={() => pick("new")}
            aria-pressed={sel === "new"}
            className={cn(
              "flex h-full min-h-[9.5rem] w-full flex-col items-center justify-center gap-2 rounded-[1.75rem] border-2 border-dashed border-border text-[14px] font-semibold text-muted-foreground transition-colors hover:border-lime hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[hsl(var(--ring))]",
              sel === "new" && "border-lime text-foreground",
            )}
          >
            <span className="grid h-11 w-11 place-items-center rounded-full bg-secondary hairline" aria-hidden="true"><Plus className="h-5 w-5" /></span>
            Add a plan
          </button>
        </li>
      </ul>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* form */}
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="la-card la-themed relative rounded-[2rem] p-3 sm:p-4 [&_label]:text-foreground/80" aria-label={current ? `Edit ${current.name}` : "New plan"}>
          <span className="la-grid rounded-[inherit]" aria-hidden="true" />
          <div className="relative flex flex-wrap items-center gap-3 px-2 pb-4 pt-2 sm:px-3">
            <DotText text={draft.name || (current ? current.name : "NEW")} className="h-8 max-w-[70%]" />
            <span className="ml-auto text-[11px] font-bold uppercase tracking-[0.12em] la-mute">{current ? (current.locked ? "Has payments" : "Editing") : "New plan"}</span>
          </div>

          <div className="relative flex flex-col gap-3">
            <Section n="01" title="Basics">
              <div>
                <Label htmlFor="pl-name">Name</Label>
                <Input id="pl-name" value={draft.name} onChange={(e) => set("name", e.target.value)} maxLength={40} />
              </div>
              <div>
                <Label htmlFor="pl-slug">Slug <span className="text-[11.5px]">{current?.locked ? "locked: has payments" : "used in links"}</span></Label>
                <Input id="pl-slug" value={draft.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} disabled={current?.locked} placeholder="auto from name" className="font-mono text-[14px]" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="pl-note">Tagline</Label>
                <Input id="pl-note" value={draft.note} onChange={(e) => set("note", e.target.value)} maxLength={80} placeholder="For one creator going faster" />
              </div>
            </Section>

            <Section n="02" title="Price">
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
              {draft.interval === "month" && (
                <div className="sm:col-span-2">
                  <Label htmlFor="pl-year">Yearly price <span className="text-[11.5px]">{draft.currency}, blank = automatic</span></Label>
                  <Input
                    id="pl-year"
                    inputMode="decimal"
                    disabled={!display.yearly || !(parsed.priceMinor > 0)}
                    value={draft.yearly}
                    placeholder={parsed.priceMinor > 0 ? String(yearlyBase({ ...parsed, yearlyMinor: 0 }, display.freeMonths) / 100) : "0"}
                    onChange={(e) => set("yearly", e.target.value.replace(/[^\d.,]/g, ""))}
                    className="tabular h-11 text-[15px]"
                    aria-describedby="pl-year-hint"
                  />
                  <p id="pl-year-hint" className="mt-1.5 text-[12px] text-muted-foreground">
                    {!display.yearly ? "Yearly billing is off for every plan (Card style and billing, above)." : !(parsed.priceMinor > 0) ? "A free plan has no yearly price." : `Blank = monthly x ${12 - display.freeMonths} (${display.freeMonths} months free). Other currencies follow the same ratio.`}
                  </p>
                </div>
              )}
              <LocalPrices d={draft} parsed={parsed} onChange={(c, v) => setDraft((x) => ({ ...x, prices: { ...x.prices, [c]: v } }))} />
            </Section>

            <Section n="03" title="What's included" hint={`${parsed.features.length}/12`}>
              <div className="sm:col-span-2">
                <Label htmlFor="pl-feat">Features <span className="text-[11.5px]">one per line</span></Label>
                <Textarea id="pl-feat" rows={6} value={draft.features} onChange={(e) => set("features", e.target.value)} />
              </div>
            </Section>

            <Section n="04" title="On the site">
              <div className="sm:col-span-2">
                <Label>Visibility</Label>
                <Seg label="Visibility" value={draft.state} onChange={(v) => set("state", v)} options={[{ value: "available", label: "On sale" }, { value: "soon", label: "Coming soon" }, { value: "hidden", label: "Hidden" }]} />
              </div>
              <div className="sm:col-span-2 grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
                <Toggle label="Highlight as most popular" hint="Only one plan can be highlighted." checked={draft.highlight} onChange={(v) => set("highlight", v)} />
                <div>
                  <Label htmlFor="pl-order">Order on the page</Label>
                  <Input id="pl-order" type="number" min={0} max={99} value={draft.sortOrder} onChange={(e) => set("sortOrder", Math.max(0, Math.min(99, Number(e.target.value) || 0)))} />
                </div>
              </div>
            </Section>

            <Section n="05" title="Plan limits">
              <div>
                <Label htmlFor="pl-posts">Posts per {draft.postPeriod}</Label>
                <Input id="pl-posts" type="number" min={0} max={100000} value={draft.postLimit} onChange={(e) => set("postLimit", Math.max(0, Math.min(100000, Math.floor(Number(e.target.value) || 0))))} aria-describedby="pl-posts-hint" />
                <p id="pl-posts-hint" className="mt-1 text-[12px] text-muted-foreground">0 = unlimited</p>
              </div>
              <div>
                <Label>Post limit resets</Label>
                <Seg label="Post limit resets" value={draft.postPeriod} onChange={(v) => set("postPeriod", v)} options={[{ value: "week", label: "Every Monday" }, { value: "month", label: "On the 1st" }]} />
              </div>
              <div>
                <Label htmlFor="pl-upload">Max upload per file (MB)</Label>
                <Input id="pl-upload" type="number" min={0} max={5000} value={draft.maxUploadMb} onChange={(e) => set("maxUploadMb", Math.max(0, Math.min(5000, Math.floor(Number(e.target.value) || 0))))} aria-describedby="pl-upload-hint" />
                <p id="pl-upload-hint" className="mt-1 text-[12px] text-muted-foreground">0 = the server maximum</p>
              </div>
              <div>
                <Label htmlFor="pl-replies">Inbox replies per week</Label>
                <Input id="pl-replies" type="number" min={0} max={100000} value={draft.replyLimit} onChange={(e) => set("replyLimit", Math.max(0, Math.min(100000, Math.floor(Number(e.target.value) || 0))))} aria-describedby="pl-replies-hint" />
                <p id="pl-replies-hint" className="mt-1 text-[12px] text-muted-foreground">0 = unlimited</p>
              </div>
              <div>
                <Label htmlFor="pl-capvids">AI-captioned videos per month</Label>
                <Input id="pl-capvids" type="number" min={0} max={10000} value={draft.captionVideos} onChange={(e) => set("captionVideos", Math.max(0, Math.min(10000, Math.floor(Number(e.target.value) || 0))))} aria-describedby="pl-capvids-hint" />
                <p id="pl-capvids-hint" className="mt-1 text-[12px] text-muted-foreground">0 = unlimited (when AI captions are on)</p>
              </div>
              <div>
                <Label htmlFor="pl-seats">Team seats</Label>
                <Input id="pl-seats" type="number" min={0} max={50} value={draft.seats} onChange={(e) => set("seats", Math.max(0, Math.min(50, Math.floor(Number(e.target.value) || 0))))} aria-describedby="pl-seats-hint" />
                <p id="pl-seats-hint" className="mt-1 text-[12px] text-muted-foreground">People besides the owner</p>
              </div>
              <div>
                <Label htmlFor="pl-accounts">Connected accounts</Label>
                <Input id="pl-accounts" type="number" min={0} max={50} value={draft.accountLimit} onChange={(e) => set("accountLimit", Math.max(0, Math.min(50, Math.floor(Number(e.target.value) || 0))))} aria-describedby="pl-accounts-hint" />
                <p id="pl-accounts-hint" className="mt-1 text-[12px] text-muted-foreground">Total, several per platform. 0 = one per platform</p>
              </div>
              <div className="sm:col-span-2">
                <Toggle label="AI captions" hint="Included on this plan" checked={draft.aiCaptions} onChange={(v) => set("aiCaptions", v)} />
              </div>
              <div className="sm:col-span-2">
                <Toggle label="Burn captions into the video" hint="Free plan: off, so burning is paid-only" checked={draft.burnCaptions} onChange={(v) => set("burnCaptions", v)} />
              </div>
            </Section>
          </div>

          <div className="liquid-panel relative" data-open={!!error}>
            <div><p role="alert" className="liquid-inner mt-3 rounded-2xl bg-destructive/10 px-4 py-3 text-[13.5px] text-destructive">{error}</p></div>
          </div>

          {/* save bar: stays in reach while the form scrolls */}
          <div className="sticky bottom-3 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-full bg-background/85 p-1.5 pl-4 shadow-[0_18px_40px_-20px_rgb(0_0_0/.5)] backdrop-blur-xl hairline">
            <span className="mr-auto flex items-center gap-2 text-[13px] font-medium">
              <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", current && !dirty ? "bg-lime" : "bg-amber-500")} />
              {current ? (dirty ? "Unsaved changes" : "Saved and live") : "Not created yet"}
            </span>
            {current && <Button type="button" variant="ghost" size="icon" onClick={() => setDel(true)} disabled={busy} aria-label={`Delete ${current.name}`} className="rounded-full text-[hsl(0_72%_38%)] hover:bg-destructive/15 dark:text-destructive"><Trash2 className="h-4 w-4" aria-hidden /></Button>}
            {current && dirty && <Button type="button" variant="ghost" className="rounded-full" onClick={() => setDraft(toDraft(current))}>Undo</Button>}
            <Button type="submit" variant={current && !dirty ? "subtle" : "lime"} className={cn("rounded-full", current && !dirty && "disabled:opacity-100")} disabled={busy || (!dirty && !!current)}>
              {busy ? "Saving…" : current ? (dirty ? "Save & publish" : "Saved") : "Create plan"}
            </Button>
          </div>
        </form>

        {/* preview */}
        <div className="xl:sticky xl:top-20 xl:self-start">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="eyebrow text-[11px]">Live preview</p>
            <a href="/#pricing" target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center rounded-full px-3 text-[13px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">Open live pricing</a>
          </div>
          {display.yearly && hasYearly(parsed, true) && (
            <div className="mb-3 flex justify-center">
              <CycleSwitch value={cycle} onChange={setCycle} save={Number.isFinite(parsed.yearlyMinor) ? yearlySaving(parsed.priceMinor, yearlyBase(parsed, display.freeMonths)) : 0} />
            </div>
          )}
          <Preview d={parsed} variant={display.cardStyle} cycle={display.yearly ? cycle : "month"} freeMonths={display.freeMonths} />
          <Impact current={current} parsed={parsed} />
        </div>
      </div>

      <ConfirmDialog open={del} onOpenChange={setDel} title={`Delete ${current?.name}?`} body="Only possible for plans nobody has paid for. If people have, set it to Hidden instead." confirmLabel="Delete plan" busy={busy} onConfirm={remove} />
    </div>
  );
}
