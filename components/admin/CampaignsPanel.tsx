"use client";
import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { PromoCard } from "@/components/promo/PromoSheet";
import { adminApi } from "@/lib/client/admin-api";
import { CURRENCIES } from "@/lib/billing/money";
import { ELIGIBILITY, ELIGIBILITY_LABEL, LIMITS, MAX_PCT, endsIn, offerLabel, offerPrice, type LiveState } from "@/lib/campaign-core";
import type { CampaignRow, CampaignsState } from "@/lib/campaign";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Empty, Pill, Table, fmtDate, type Tone } from "./ui";

const STATE: Record<LiveState, { tone: Tone; label: string }> = {
  live: { tone: "lime", label: "Live" },
  scheduled: { tone: "info", label: "Scheduled" },
  off: { tone: "muted", label: "Off" },
  ended: { tone: "muted", label: "Ended" },
  "sold-out": { tone: "warn", label: "Sold out" },
  invalid: { tone: "warn", label: "Needs fixing" },
};

/** datetime-local value in the admin's own time zone. */
const local = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

interface Draft {
  id?: string;
  title: string;
  kind: "pct" | "fixed";
  value: string;
  currency: string;
  planSlugs: string[];
  startsAt: string;
  endsAt: string;
  badge: string;
  headline: string;
  body: string;
  benefits: string;
  terms: string;
  ctaText: string;
  ctaHref: string;
  eligibility: string;
  active: boolean;
  maxRedemptions: string;
}

function blank(plans: CampaignsState["plans"]): Draft {
  const now = new Date();
  return {
    title: "Flash Sale", kind: "pct", value: "40", currency: plans[0]?.currency ?? "INR", planSlugs: plans[0] ? [plans[0].slug] : [],
    startsAt: local(now.toISOString()), endsAt: local(new Date(now.getTime() + 3 * 86_400_000).toISOString()),
    badge: "Flash Sale", headline: "", body: "", benefits: "", terms: "First payment only. Renews at the regular price. Cancel any time.",
    ctaText: "Claim Offer Now", ctaHref: "/billing", eligibility: "free", active: false, maxRedemptions: "0",
  };
}

function fromRow(c: CampaignRow): Draft {
  return {
    id: c.id, title: c.title, kind: c.kind === "fixed" ? "fixed" : "pct", value: c.kind === "fixed" ? String(c.value / 100) : String(c.value), currency: c.currency, planSlugs: c.planSlugs,
    startsAt: local(c.startsAt), endsAt: local(c.endsAt), badge: c.banner.badge, headline: c.banner.headline, body: c.banner.body, benefits: c.banner.benefits.join("\n"), terms: c.banner.terms,
    ctaText: c.ctaText, ctaHref: c.ctaHref, eligibility: c.eligibility, active: c.active, maxRedemptions: String(c.maxRedemptions),
  };
}

/** Offers: the list with each one's funnel, and an editor with a live preview of the popup. */
export function CampaignsPanel({ initial }: { initial: CampaignsState }) {
  const toast = useToast();
  const [st, setSt] = useState(initial);
  const [d, setD] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [del, setDel] = useState<CampaignRow | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => (x ? { ...x, [k]: v } : x));

  async function run(key: string, body: unknown, ok?: string) {
    setBusy(key);
    try {
      setSt(await adminApi<CampaignsState>("/api/admin/campaigns", { method: "POST", json: body }));
      if (ok) toast(ok);
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const value = d ? (d.kind === "fixed" ? Math.round(Number(d.value) * 100) : Math.floor(Number(d.value))) : 0;
  async function save() {
    if (!d) return;
    const body = {
      action: "save", id: d.id, title: d.title, kind: d.kind, value, currency: d.currency, planSlugs: d.planSlugs,
      startsAt: new Date(d.startsAt).toISOString(), endsAt: new Date(d.endsAt).toISOString(),
      banner: { badge: d.badge, headline: d.headline, body: d.body, benefits: d.benefits.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, LIMITS.benefits), terms: d.terms },
      ctaText: d.ctaText, ctaHref: d.ctaHref, eligibility: d.eligibility, active: d.active, maxRedemptions: Math.max(0, Math.floor(Number(d.maxRedemptions) || 0)),
    };
    if (await run("save", body, d.id ? "Offer saved." : "Offer created.")) setD(null);
  }

  // Preview with the lead plan's list price; real visitors see their own price (currency, price test, founding).
  const preview = useMemo(() => {
    if (!d) return null;
    const plan = st.plans.find((p) => p.slug === d.planSlugs[0]);
    if (!plan) return null;
    const c = { kind: d.kind, value, currency: d.currency };
    const final = offerPrice(c, plan.priceMinor, plan.currency);
    return {
      final,
      offer: {
        id: "preview", label: offerLabel(c), badge: d.badge || "Limited offer", headline: d.headline || d.title, body: d.body,
        benefits: d.benefits.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, LIMITS.benefits), terms: d.terms, ctaText: d.ctaText || "Claim Offer Now", href: "#",
        endsLabel: endsIn(new Date(d.endsAt)), plan: { slug: plan.slug, name: plan.name }, cycle: "month" as const, currency: plan.currency,
        originalMinor: plan.priceMinor, finalMinor: final ?? plan.priceMinor, renewMinor: plan.priceMinor,
        left: Number(d.maxRedemptions) > 0 ? Number(d.maxRedemptions) : null,
      },
    };
  }, [d, st.plans, value]);

  return (
    <div className="grid grid-cols-1 gap-4">
      <Card className="min-w-0">
        <CardTitle
          hint="Impressions, dismissals and clicks count each person once a day. Conversions are confirmed payments only."
          action={<Button type="button" variant="lime" size="sm" className="shrink-0" onClick={() => setD(blank(st.plans))} disabled={!!d}><Plus className="h-4 w-4" aria-hidden /> New offer</Button>}
        >
          Offers
        </CardTitle>
        {st.campaigns.length === 0 ? (
          <Empty title="No offers yet" body="Make one, preview the popup, then switch it on." />
        ) : (
          <Table label="Offers" head={["Offer", "Status", "Runs", "Seen", "Closed", "Clicked", "Paid", <span key="a" className="sr-only">Actions</span>]}>
            {st.campaigns.map((c) => (
              <tr key={c.id}>
                <td>
                  <p className="font-semibold">{c.title}</p>
                  <p className="text-[12px] text-muted-foreground">{c.label} · {c.planSlugs.join(", ")} · {ELIGIBILITY_LABEL[c.eligibility as keyof typeof ELIGIBILITY_LABEL]?.split(" (")[0] ?? c.eligibility}</p>
                </td>
                <td><Pill tone={STATE[c.state].tone}>{STATE[c.state].label}</Pill></td>
                <td className="whitespace-nowrap text-[12.5px] text-muted-foreground">{fmtDate(c.startsAt, true)}<br />to {fmtDate(c.endsAt, true)}</td>
                <td className="tabular">{c.funnel.impressions}</td>
                <td className="tabular">{c.funnel.dismissals}</td>
                <td className="tabular">{c.funnel.clicks}<span className="block text-[11.5px] text-muted-foreground">{c.funnel.ctr}%</span></td>
                <td className="tabular">{c.funnel.conversions}{c.maxRedemptions > 0 && <span className="text-muted-foreground"> / {c.maxRedemptions}</span>}<span className="block text-[11.5px] text-muted-foreground">{c.funnel.cvr}% of clicks</span></td>
                <td>
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" role="switch" aria-checked={c.active} aria-label={`${c.title} on`} disabled={!!busy} onClick={() => run(`t-${c.id}`, { action: "toggle", id: c.id, active: !c.active }, c.active ? "Offer switched off." : "Offer switched on.")}
                      className={cn("relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-300 disabled:opacity-60", c.active ? "bg-success" : "bg-foreground/20")}>
                      <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-300", c.active ? "translate-x-6" : "translate-x-1")} />
                    </button>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Edit ${c.title}`} onClick={() => setD(fromRow(c))}><Pencil className="h-4 w-4" aria-hidden /></Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Delete ${c.title}`} disabled={c.redemptions > 0} title={c.redemptions > 0 ? "People paid with it: switch it off instead" : undefined} onClick={() => setDel(c)}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {d && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Card>
            <CardTitle hint="No price is typed here: the offer is taken off each person's real price at checkout.">{d.id ? "Edit offer" : "New offer"}</CardTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><Label htmlFor="co-title">Title (admin and invoice)</Label><Input id="co-title" value={d.title} maxLength={LIMITS.title} onChange={(e) => set("title", e.target.value)} /></div>
              <div>
                <Label htmlFor="co-kind">Discount</Label>
                <select id="co-kind" value={d.kind} onChange={(e) => set("kind", e.target.value as Draft["kind"])} className="h-11 w-full rounded-2xl bg-secondary/50 px-3 text-[14px] hairline">
                  <option value="pct">Percent off</option>
                  <option value="fixed">Fixed amount off</option>
                </select>
              </div>
              <div>
                <Label htmlFor="co-value">{d.kind === "pct" ? `Percent (1-${MAX_PCT})` : "Amount off"}</Label>
                <div className="flex gap-2">
                  <Input id="co-value" type="number" inputMode="decimal" min={1} max={d.kind === "pct" ? MAX_PCT : undefined} value={d.value} onChange={(e) => set("value", e.target.value)} />
                  {d.kind === "fixed" && (
                    <select aria-label="Currency" value={d.currency} onChange={(e) => set("currency", e.target.value)} className="h-11 rounded-2xl bg-secondary/50 px-3 text-[14px] hairline">
                      {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  )}
                </div>
                {d.kind === "fixed" && <p className="mt-1 text-[12px] text-muted-foreground">Only buyers charged in {d.currency} get it.</p>}
              </div>
              <fieldset className="sm:col-span-2">
                <legend className="mb-2 text-[13px] font-medium text-muted-foreground">Plans (the first one is shown in the popup)</legend>
                <div className="flex flex-wrap gap-2">
                  {st.plans.map((p) => {
                    const on = d.planSlugs.includes(p.slug);
                    return (
                      <label key={p.slug} className={cn("inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-2xl px-3 text-[14px] hairline", on && "bg-lime/15")}>
                        <input type="checkbox" checked={on} onChange={() => set("planSlugs", on ? d.planSlugs.filter((s) => s !== p.slug) : [...d.planSlugs, p.slug])} />
                        {p.name}{p.state !== "available" && <span className="text-[12px] text-muted-foreground">({p.state})</span>}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <div><Label htmlFor="co-start">Starts</Label><Input id="co-start" type="datetime-local" value={d.startsAt} onChange={(e) => set("startsAt", e.target.value)} /></div>
              <div><Label htmlFor="co-end">Ends</Label><Input id="co-end" type="datetime-local" value={d.endsAt} onChange={(e) => set("endsAt", e.target.value)} /></div>
              <div>
                <Label htmlFor="co-elig">Who sees it</Label>
                <select id="co-elig" value={d.eligibility} onChange={(e) => set("eligibility", e.target.value)} className="h-11 w-full rounded-2xl bg-secondary/50 px-3 text-[14px] hairline">
                  {ELIGIBILITY.map((e) => <option key={e} value={e}>{ELIGIBILITY_LABEL[e]}</option>)}
                </select>
              </div>
              <div><Label htmlFor="co-max">Max redemptions (0 = no cap)</Label><Input id="co-max" type="number" inputMode="numeric" min={0} value={d.maxRedemptions} onChange={(e) => set("maxRedemptions", e.target.value)} /></div>
              <div><Label htmlFor="co-badge">Badge</Label><Input id="co-badge" value={d.badge} maxLength={LIMITS.badge} onChange={(e) => set("badge", e.target.value)} /></div>
              <div><Label htmlFor="co-head">Headline (above the discount)</Label><Input id="co-head" value={d.headline} maxLength={LIMITS.headline} placeholder={d.title} onChange={(e) => set("headline", e.target.value)} /></div>
              <div className="sm:col-span-2"><Label htmlFor="co-body">Short line</Label><Input id="co-body" value={d.body} maxLength={LIMITS.body} onChange={(e) => set("body", e.target.value)} /></div>
              <div className="sm:col-span-2"><Label htmlFor="co-ben">Benefits (one per line, up to {LIMITS.benefits})</Label><Textarea id="co-ben" rows={3} value={d.benefits} onChange={(e) => set("benefits", e.target.value)} /></div>
              <div className="sm:col-span-2"><Label htmlFor="co-terms">Terms</Label><Textarea id="co-terms" rows={2} maxLength={LIMITS.terms} value={d.terms} onChange={(e) => set("terms", e.target.value)} /></div>
              <div><Label htmlFor="co-cta">Button text</Label><Input id="co-cta" value={d.ctaText} maxLength={LIMITS.cta} onChange={(e) => set("ctaText", e.target.value)} /></div>
              <div><Label htmlFor="co-href">Button goes to</Label><Input id="co-href" value={d.ctaHref} maxLength={LIMITS.href} onChange={(e) => set("ctaHref", e.target.value)} aria-describedby="co-href-hint" /><p id="co-href-hint" className="mt-1 text-[12px] text-muted-foreground">A page in Outlly. The offer and plan are added for checkout.</p></div>
              <label className="flex min-h-[44px] items-center gap-2 text-[14px] sm:col-span-2"><input type="checkbox" checked={d.active} onChange={(e) => set("active", e.target.checked)} /> On (shows between the start and end times)</label>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button type="button" variant="lime" onClick={save} disabled={busy === "save" || !d.planSlugs.length || !d.title.trim()}>{busy === "save" ? "Saving" : d.id ? "Save offer" : "Create offer"}</Button>
              <Button type="button" variant="subtle" onClick={() => setD(null)}>Cancel</Button>
            </div>
          </Card>
          <Card>
            <CardTitle hint="At the lead plan's list price. Each person sees their own price (currency, price test, founding).">Preview</CardTitle>
            {preview ? (
              <>
                {preview.final === null && <p className="mb-3 rounded-2xl bg-warning/15 p-3 text-[13px]">This offer doesn't lower the {preview.offer.plan.name} price in {preview.offer.currency}, so nobody would see it.</p>}
                <div className="mx-auto max-w-[400px]"><PromoCard offer={preview.offer} preview onClose={() => {}} /></div>
              </>
            ) : (
              <Empty title="Pick a plan" body="The popup shows the first plan you tick." />
            )}
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title={`Delete "${del?.title ?? ""}"?`}
        body="Its numbers go with it. Nobody has paid with it yet."
        confirmLabel="Delete offer"
        busy={busy === "del"}
        onConfirm={async () => { if (del && (await run("del", { action: "delete", id: del.id }, "Offer deleted."))) setDel(null); }}
      />
    </div>
  );
}
