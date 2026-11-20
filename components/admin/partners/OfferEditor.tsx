"use client";
import { useCallback, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Gift, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Card, CardTitle, Empty, LoadingState, Pill, fmtDate, type Tone } from "@/components/admin/ui";
import { adminApi } from "@/lib/client/admin-api";
import { cn } from "@/lib/utils";
import { OFFER_CURRENCIES, OFFER_STATUS_LABEL, OFFER_TYPE_LABEL, durationLabel, offerTermsOf } from "@/lib/partners/offer-core";
import { PARTNER_OFFER_TYPES, PARTNER_PLATFORMS, PARTNER_PLATFORM_LABEL, type PartnerOfferType } from "@/lib/partners/types";

type Grant = { id: string; status: string; plan: string; planName: string; startsAt: string; endsAt: string } | null;
type Offer = {
  id: string; status: string; type: string; amountMinor: number; currency: string; paymentTerms: string; planSlug: string; subscriptionDays: number;
  startsAt: string | null; endsAt: string | null; deliverables: number; platforms: string[]; format: string; deadlines: string; disclosure: boolean;
  usageRights: string; conditions: string; expiresAt: string | null; sentAt: string | null; respondedAt: string | null; declineReason: string;
  createdAt: string; grant: Grant; benefit: { action: string; at: string; meta: Record<string, unknown> } | null;
};
type PlanOpt = { slug: string; name: string };
const FALLBACK_PLANS: PlanOpt[] = [{ slug: "creator", name: "Creator" }, { slug: "studio", name: "Studio" }, { slug: "pro-manager", name: "Pro" }];

const STATUS_TONE: Record<string, Tone> = { draft: "muted", sent: "info", accepted: "ok", declined: "bad", withdrawn: "muted", expired: "warn" };
const GRANT_LABEL: Record<string, string> = { active: "Active", pending: "Waiting for email verification", revoked: "Ended", expired: "Expired" };

type Draft = {
  type: PartnerOfferType; amount: string; currency: string; paymentTerms: string; planSlug: string; duration: "30" | "60" | "custom"; customDays: string;
  startsAt: string; endsAt: string; deliverables: string; platforms: string[]; format: string; deadlines: string; disclosure: boolean; usageRights: string; conditions: string;
};
const EMPTY: Draft = {
  type: "subscription", amount: "", currency: "INR", paymentTerms: "", planSlug: "creator", duration: "30", customDays: "", startsAt: "", endsAt: "",
  deliverables: "1", platforms: [], format: "", deadlines: "", disclosure: true, usageRights: "", conditions: "",
};
const day = (d: string | null) => (d ? d.slice(0, 10) : "");
function fromOffer(o: Offer): Draft {
  const dur = o.subscriptionDays === 30 ? "30" : o.subscriptionDays === 60 ? "60" : o.subscriptionDays ? "custom" : "30";
  return {
    type: o.type as PartnerOfferType, amount: o.amountMinor ? String(o.amountMinor / 100) : "", currency: o.currency, paymentTerms: o.paymentTerms,
    planSlug: o.planSlug || "creator", duration: dur, customDays: dur === "custom" ? String(o.subscriptionDays) : "", startsAt: day(o.startsAt), endsAt: day(o.endsAt),
    deliverables: String(o.deliverables), platforms: o.platforms, format: o.format, deadlines: o.deadlines, disclosure: o.disclosure, usageRights: o.usageRights, conditions: o.conditions,
  };
}
function toBody(d: Draft) {
  const paid = d.type !== "subscription";
  const sub = d.type !== "paid";
  const days = d.duration === "custom" ? Math.floor(Number(d.customDays) || 0) : Number(d.duration);
  return {
    type: d.type,
    amountMinor: paid ? Math.round((Number(d.amount.replace(/[, ]/g, "")) || 0) * 100) : 0,
    currency: d.currency,
    paymentTerms: paid ? d.paymentTerms : "",
    planSlug: sub ? d.planSlug : "",
    subscriptionDays: sub ? days : 0,
    startsAt: d.startsAt || null,
    endsAt: d.endsAt || null,
    deliverables: Math.max(0, Math.floor(Number(d.deliverables) || 0)),
    platforms: d.platforms,
    format: d.format, deadlines: d.deadlines, disclosure: d.disclosure, usageRights: d.usageRights, conditions: d.conditions,
  };
}

const select = "h-11 w-full rounded-[12px] border border-foreground/[0.08] bg-secondary/50 px-3 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const choice = (on: boolean) =>
  cn("inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[12px] px-3.5 text-[13.5px] focus-within:ring-2 focus-within:ring-ring", on ? "bg-lime/20 font-semibold text-lime-ink" : "bg-secondary/40 text-muted-foreground");

function OfferForm({ initial, plans, busy, onSave, onCancel }: { initial: Draft; plans: PlanOpt[]; busy: boolean; onSave: (d: Draft, send: boolean) => void; onCancel: () => void }) {
  const [d, setD] = useState(initial);
  const id = useId();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const paid = d.type !== "subscription";
  const sub = d.type !== "paid";
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); onSave(d, false); }}>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-muted-foreground">Offer type</legend>
        <div className="flex flex-wrap gap-2">
          {PARTNER_OFFER_TYPES.map((t) => (
            <label key={t} className={choice(d.type === t)}>
              <input type="radio" name={`${id}-type`} value={t} checked={d.type === t} onChange={() => set("type", t)} className="h-4 w-4 accent-lime" />
              {OFFER_TYPE_LABEL[t]}
            </label>
          ))}
        </div>
      </fieldset>

      {paid && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <div>
            <Label htmlFor={`${id}-amt`}>Amount</Label>
            <Input id={`${id}-amt`} inputMode="decimal" value={d.amount} onChange={(e) => set("amount", e.target.value)} placeholder="15000" className="h-11 rounded-[12px]" />
          </div>
          <div>
            <Label htmlFor={`${id}-cur`}>Currency</Label>
            <select id={`${id}-cur`} value={d.currency} onChange={(e) => set("currency", e.target.value)} className={select}>
              {OFFER_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor={`${id}-pt`}>Payment terms</Label>
            <Input id={`${id}-pt`} value={d.paymentTerms} maxLength={500} onChange={(e) => set("paymentTerms", e.target.value)} placeholder="50% on acceptance, 50% after publication" className="h-11 rounded-[12px]" />
          </div>
        </div>
      )}

      {sub && (
        <div className="grid gap-3">
          <div>
            <Label htmlFor={`${id}-plan`}>Complimentary plan</Label>
            <select id={`${id}-plan`} value={d.planSlug} onChange={(e) => set("planSlug", e.target.value)} className={select}>
              {plans.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
            </select>
          </div>
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-muted-foreground">How long</legend>
            <div className="flex flex-wrap items-center gap-2">
              {(["30", "60", "custom"] as const).map((v) => (
                <label key={v} className={choice(d.duration === v)}>
                  <input type="radio" name={`${id}-dur`} value={v} checked={d.duration === v} onChange={() => set("duration", v)} className="h-4 w-4 accent-lime" />
                  {v === "custom" ? "Custom" : durationLabel(Number(v))}
                </label>
              ))}
              {d.duration === "custom" && (
                <div className="w-32">
                  <Label htmlFor={`${id}-days`} className="sr-only">Days</Label>
                  <Input id={`${id}-days`} type="number" min={1} max={366} value={d.customDays} onChange={(e) => set("customDays", e.target.value)} placeholder="Days" className="h-11 rounded-[12px]" />
                </div>
              )}
            </div>
          </fieldset>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor={`${id}-start`}>Start date</Label>
          <Input id={`${id}-start`} type="date" value={d.startsAt} onChange={(e) => set("startsAt", e.target.value)} className="h-11 rounded-[12px]" />
        </div>
        <div>
          <Label htmlFor={`${id}-end`}>End or review date</Label>
          <Input id={`${id}-end`} type="date" value={d.endsAt} onChange={(e) => set("endsAt", e.target.value)} className="h-11 rounded-[12px]" />
        </div>
        <div>
          <Label htmlFor={`${id}-n`}>Deliverables</Label>
          <Input id={`${id}-n`} type="number" min={0} max={100} value={d.deliverables} onChange={(e) => set("deliverables", e.target.value)} className="h-11 rounded-[12px]" />
        </div>
      </div>

      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-muted-foreground">Platforms</legend>
        <div className="flex flex-wrap gap-2">
          {PARTNER_PLATFORMS.map((p) => {
            const on = d.platforms.includes(p);
            return (
              <label key={p} className={choice(on)}>
                <input type="checkbox" checked={on} onChange={() => set("platforms", on ? d.platforms.filter((x) => x !== p) : [...d.platforms, p])} className="h-4 w-4 accent-lime" />
                {PARTNER_PLATFORM_LABEL[p]}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-fmt`}>Format</Label>
          <Input id={`${id}-fmt`} value={d.format} maxLength={120} onChange={(e) => set("format", e.target.value)} placeholder="2 Reels and 3 Stories" className="h-11 rounded-[12px]" />
        </div>
        <div>
          <Label htmlFor={`${id}-dl`}>Deadlines</Label>
          <Input id={`${id}-dl`} value={d.deadlines} maxLength={500} onChange={(e) => set("deadlines", e.target.value)} placeholder="First post within 14 days of acceptance" className="h-11 rounded-[12px]" />
        </div>
      </div>

      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] bg-secondary/40 px-4 text-[14px]">
        <input type="checkbox" checked={d.disclosure} onChange={(e) => set("disclosure", e.target.checked)} className="h-5 w-5 accent-lime" />
        Require a paid partnership or sponsored label
      </label>

      <div>
        <Label htmlFor={`${id}-ur`}>Usage rights</Label>
        <Textarea id={`${id}-ur`} rows={2} maxLength={1000} value={d.usageRights} onChange={(e) => set("usageRights", e.target.value)} placeholder="Outlly may repost the content on its own accounts for 6 months, with credit" className="rounded-[12px]" />
      </div>
      <div>
        <Label htmlFor={`${id}-cond`}>Other conditions</Label>
        <Textarea id={`${id}-cond`} rows={2} maxLength={2000} value={d.conditions} onChange={(e) => set("conditions", e.target.value)} className="rounded-[12px]" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="subtle" disabled={busy}>{busy ? "Saving…" : "Save draft"}</Button>
        <Button type="button" variant="lime" disabled={busy} onClick={() => onSave(d, true)}>Save and send</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function Summary({ o, plans }: { o: Offer; plans: PlanOpt[] }) {
  const t = offerTermsOf(o, plans.find((p) => p.slug === o.planSlug)?.name);
  const bits = [t.amount && `${t.amount}${t.paymentTerms ? `, ${t.paymentTerms}` : ""}`, t.planName && t.subscriptionDays > 0 && `${t.planName}, ${durationLabel(t.subscriptionDays)}`, t.deliverables > 0 && `${t.deliverables} deliverables`, t.platformLabels.join(", ")].filter(Boolean);
  return <p className="text-[13px] leading-normal text-muted-foreground">{bits.join(" · ") || "No terms yet"}</p>;
}

type Ask = { kind: "send" | "withdraw" | "end" | "extend" | "change" | "grant"; offer: Offer } | null;

export default function OfferEditor({ applicationId, status, email }: { applicationId: string; status: string; email: string }) {
  const toast = useToast();
  const router = useRouter();
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [plans, setPlans] = useState<PlanOpt[]>(FALLBACK_PLANS);
  const [editing, setEditing] = useState<Offer | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<Ask>(null);
  const [val, setVal] = useState("");
  const fid = useId();
  const base = `/api/admin/partners/${applicationId}/offers`;

  const load = useCallback(async () => {
    try {
      const r = await adminApi<{ offers: Offer[] }>(base);
      setOffers(r.offers);
    } catch (e) {
      toast((e as Error).message, "error");
      setOffers([]);
    }
  }, [base, toast]);

  useEffect(() => {
    void load();
    adminApi<{ plans: { slug: string; name: string; priceMinor: number }[] }>("/api/admin/plans")
      .then((r) => {
        const paid = r.plans.filter((p) => p.slug !== "free").map((p) => ({ slug: p.slug, name: p.name }));
        if (paid.length) setPlans(paid);
      })
      .catch(() => {});
  }, [load]);

  async function run(fn: () => Promise<unknown>, ok: string, refresh = false) {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      setAsk(null);
      await load();
      if (refresh) router.refresh();
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save(d: Draft, send: boolean) {
    const body = toBody(d);
    setBusy(true);
    let saved: Offer | null = null;
    try {
      saved = editing && editing !== "new"
        ? (await adminApi<{ offer: Offer }>(`${base}/${editing.id}`, { method: "PATCH", json: body })).offer
        : (await adminApi<{ offer: Offer }>(base, { method: "POST", json: body })).offer;
      setEditing(null);
      await load();
      if (!send) toast("Draft saved. The creator sees nothing until you send it.");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
    if (saved && send) setAsk({ kind: "send", offer: { ...saved, platforms: body.platforms } as Offer });
  }

  const closed = ["rejected", "withdrawn", "completed"].includes(status);
  const confirmCopy: Record<NonNullable<Ask>["kind"], { title: string; body: string; label: string; tone: "danger" | "primary" }> = {
    send: { title: "Send this offer?", body: "The creator gets an email with a link that expires in 14 days.", label: "Send offer", tone: "primary" },
    withdraw: { title: "Withdraw this offer?", body: "The link stops working. A sent offer puts the application back to Approved, without emailing the creator.", label: "Withdraw offer", tone: "danger" },
    end: { title: "End the complimentary plan?", body: `The creator (${email}) is emailed first, then the plan ends today. Any plan they pay for keeps running.`, label: "End benefit", tone: "danger" },
    extend: { title: "Extend the complimentary plan?", body: "The days are added on top of what is left.", label: "Extend", tone: "primary" },
    change: { title: "Change the plan?", body: "The dates stay the same. Only the plan changes.", label: "Change plan", tone: "primary" },
    grant: { title: "Grant the plan now?", body: "Use this when the automatic grant was skipped or failed. It stacks under any paid plan and never changes a subscription.", label: "Grant now", tone: "primary" },
  };

  function confirm() {
    if (!ask) return;
    const o = ask.offer;
    const b = `${base}/${o.id}`;
    if (ask.kind === "send") return void run(() => adminApi(`${b}/send`, { method: "POST", json: {} }), "Offer sent. The creator has the link by email.", true);
    if (ask.kind === "withdraw") return void run(() => adminApi(b, { method: "DELETE" }), "Offer withdrawn.", true);
    if (ask.kind === "grant") return void run(() => adminApi(`${b}/benefit`, { method: "POST", json: { action: "grant" } }), "Benefit granted.", true);
    if (ask.kind === "extend") {
      const days = Math.floor(Number(val));
      if (!(days >= 1 && days <= 366)) return toast("Enter 1 to 366 days.", "error");
      return void run(() => adminApi(`${b}/benefit`, { method: "POST", json: { action: "extend", days } }), `Extended by ${durationLabel(days)}.`);
    }
    if (ask.kind === "change") return void run(() => adminApi(`${b}/benefit`, { method: "POST", json: { action: "change", planSlug: val } }), "Plan changed.");
    if (val.trim().length < 3) return toast("Say why, for the creator and the audit trail.", "error");
    return void run(() => adminApi(`${b}/benefit`, { method: "POST", json: { action: "end", reason: val.trim() } }), "Benefit ended. The creator was emailed.");
  }

  const open = (kind: NonNullable<Ask>["kind"], offer: Offer) => {
    setVal(kind === "extend" ? "30" : kind === "change" ? (plans.find((p) => p.slug !== offer.grant?.plan)?.slug ?? "") : "");
    setAsk({ kind, offer });
  };

  return (
    <Card>
      <CardTitle
        hint="Approval never grants anything. A benefit starts only when the creator accepts an offer."
        action={!closed && !editing && <Button type="button" size="sm" variant="lime" onClick={() => setEditing("new")}><Plus className="h-4 w-4" aria-hidden="true" /> New offer</Button>}
      >
        Offers
      </CardTitle>

      {editing && (
        <div className="mb-5 rounded-[16px] bg-secondary/30 p-4 sm:p-5">
          <h3 className="mb-4 text-[14px] font-semibold">{editing === "new" ? "New offer" : "Edit draft"}</h3>
          <OfferForm initial={editing === "new" ? EMPTY : fromOffer(editing)} plans={plans} busy={busy} onSave={(d, s) => void save(d, s)} onCancel={() => setEditing(null)} />
        </div>
      )}

      {offers === null ? (
        <LoadingState lines={2} label="Loading offers" />
      ) : offers.length === 0 ? (
        !editing && <Empty title="No offers yet" body={status === "approved" ? "Write the offer, save it as a draft, then send it." : "Approve the application first, then send an offer."} />
      ) : (
        <ul className="grid gap-3">
          {offers.map((o) => (
            <li key={o.id} className="rounded-[16px] bg-secondary/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[14px] font-semibold">{OFFER_TYPE_LABEL[o.type as PartnerOfferType] ?? o.type}</p>
                <Pill tone={STATUS_TONE[o.status] ?? "muted"}>{OFFER_STATUS_LABEL[o.status] ?? o.status}</Pill>
              </div>
              <div className="mt-1"><Summary o={o} plans={plans} /></div>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {o.status === "sent" && o.expiresAt ? `Sent ${fmtDate(o.sentAt)}, link expires ${fmtDate(o.expiresAt)}` : o.respondedAt ? `Answered ${fmtDate(o.respondedAt)}` : `Created ${fmtDate(o.createdAt)}`}
                {o.declineReason ? `. Reason: ${o.declineReason}` : ""}
              </p>
              {(o.status === "draft" || o.status === "sent") && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {o.status === "draft" && <Button type="button" size="sm" variant="subtle" disabled={busy} onClick={() => setEditing(o)}>Edit</Button>}
                  {o.status === "draft" && <Button type="button" size="sm" variant="lime" disabled={busy || status !== "approved"} onClick={() => open("send", o)}>Send offer</Button>}
                  <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => open("withdraw", o)}>Withdraw</Button>
                </div>
              )}
              {o.status === "accepted" && o.planSlug && o.subscriptionDays > 0 && (
                <section aria-label="Benefit" className="mt-3 rounded-[12px] bg-card p-3.5">
                  <p className="flex items-center gap-2 text-[13px] font-semibold"><Gift className="h-4 w-4" aria-hidden="true" /> Benefit</p>
                  {o.grant ? (
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      {o.grant.planName}, {fmtDate(o.grant.startsAt)} to {fmtDate(o.grant.endsAt)} · {GRANT_LABEL[o.grant.status] ?? o.grant.status}
                    </p>
                  ) : (
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      {o.benefit?.action === "benefit.skipped" ? "Skipped: the creator already pays for this plan or a higher one." : o.benefit?.action === "benefit.error" ? `Not granted: ${String(o.benefit.meta.error ?? "an error")}` : "Not granted yet."}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {!o.grant && <Button type="button" size="sm" variant="lime" disabled={busy} onClick={() => open("grant", o)}>Grant now</Button>}
                    {o.grant && o.grant.status !== "revoked" && (
                      <>
                        <Button type="button" size="sm" variant="subtle" disabled={busy} onClick={() => open("extend", o)}>Extend</Button>
                        <Button type="button" size="sm" variant="subtle" disabled={busy} onClick={() => open("change", o)}>Change plan</Button>
                        <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => open("end", o)}>End</Button>
                      </>
                    )}
                  </div>
                </section>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!ask}
        onOpenChange={(o) => !o && !busy && setAsk(null)}
        title={ask ? confirmCopy[ask.kind].title : ""}
        body={ask ? confirmCopy[ask.kind].body : ""}
        confirmLabel={ask ? confirmCopy[ask.kind].label : ""}
        cancelLabel="Cancel"
        tone={ask ? confirmCopy[ask.kind].tone : "primary"}
        busy={busy}
        extra={
          ask?.kind === "extend" ? (
            <div className="mt-3">
              <Label htmlFor={`${fid}-x`}>Days to add</Label>
              <Input id={`${fid}-x`} type="number" min={1} max={366} value={val} onChange={(e) => setVal(e.target.value)} className="h-11 rounded-[12px]" />
            </div>
          ) : ask?.kind === "change" ? (
            <div className="mt-3">
              <Label htmlFor={`${fid}-p`}>New plan</Label>
              <select id={`${fid}-p`} value={val} onChange={(e) => setVal(e.target.value)} className={select}>
                {plans.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
              </select>
            </div>
          ) : ask?.kind === "end" ? (
            <div className="mt-3">
              <Label htmlFor={`${fid}-r`}>Reason (the creator reads this)</Label>
              <Input id={`${fid}-r`} value={val} maxLength={300} onChange={(e) => setVal(e.target.value)} placeholder="The agreed content was not published" className="h-11 rounded-[12px]" />
            </div>
          ) : undefined
        }
        onConfirm={confirm}
      />
    </Card>
  );
}
