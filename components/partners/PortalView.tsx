"use client";
import { useId, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { api, ApiError } from "@/lib/client/api";
import { fmtDay } from "@/lib/partners/offer-core";
import { DELIVERABLE_STATUS_LABEL, PARTNER_PLATFORM_LABEL, type DeliverableStatus, type PartnerPlatform } from "@/lib/partners/types";
import type { PublicDeliverable } from "@/lib/partners/deliverables";

export type PortalData = {
  firstName: string;
  ref: string;
  status: string;
  link: string | null;
  benefit: { plan: string; state: string; startsAt: string | null; endsAt: string | null } | null;
  deliverables: PublicDeliverable[];
  counts: { visits: number; signups: number };
};

const card = "rounded-[24px] border border-foreground/[0.08] bg-card p-6 sm:p-8";
const nf = new Intl.NumberFormat("en-IN");

function benefitLine(b: NonNullable<PortalData["benefit"]>) {
  if (b.state === "pending") return "Ready for you. It starts once you verify the email address this offer was sent to on your Outlly account.";
  if (b.state === "revoked") return "This complimentary plan has ended.";
  if (b.state === "not_granted") return "Being set up by the team. You will get an email when it is active.";
  if (b.startsAt && b.endsAt) return `${fmtDay(b.startsAt)} to ${fmtDay(b.endsAt)}`;
  return "Active";
}

function CopyLink({ link }: { link: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setDone(true);
      window.setTimeout(() => setDone(false), 2000);
    } catch {
      setDone(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <code className="min-h-11 flex-1 truncate rounded-[12px] bg-secondary/60 px-4 py-3 text-[14px] [overflow-wrap:anywhere]">{link}</code>
      <Button type="button" variant="lime" onClick={() => void copy()} aria-label={done ? "Link copied" : "Copy your referral link"}>
        {done ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
        {done ? "Copied" : "Copy link"}
      </Button>
      <span role="status" className="sr-only">{done ? "Link copied" : ""}</span>
    </div>
  );
}

type Form = { url: string; publishedAt: string; note: string; views: string; reach: string; likes: string; comments: string };
const blank = (d: PublicDeliverable): Form => ({
  url: d.url, publishedAt: (d.publishedAt ?? new Date().toISOString()).slice(0, 10), note: d.creatorNote,
  views: d.views ? String(d.views) : "", reach: d.reach ? String(d.reach) : "", likes: d.likes ? String(d.likes) : "", comments: d.comments ? String(d.comments) : "",
});
const num = (s: string) => (s.trim() === "" ? undefined : Math.max(0, Math.floor(Number(s.replace(/[, ]/g, ""))) || 0));

export function PortalView({ token, data }: { token: string; data: PortalData }) {
  const [items, setItems] = useState(data.deliverables);
  const [open, setOpen] = useState<PublicDeliverable | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState("");
  const ids = { url: useId(), date: useId(), note: useId(), views: useId(), reach: useId(), likes: useId(), comments: useId() };

  async function submit() {
    if (!open || !f || busy) return;
    if (!/^https?:\/\//i.test(f.url.trim())) return setErr("Paste the full link to the post, starting with https://");
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ deliverable: PublicDeliverable }>(`/api/partners/portal/${token}/deliverables`, {
        method: "POST",
        json: { id: open.id, url: f.url.trim(), publishedAt: f.publishedAt || null, note: f.note.trim() || undefined, views: num(f.views), reach: num(f.reach), likes: num(f.likes), comments: num(f.comments) },
      });
      setItems((xs) => xs.map((x) => (x.id === r.deliverable.id ? r.deliverable : x)));
      setSaved(`Link submitted for ${r.deliverable.title}. The team will review it.`);
      setOpen(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "That didn't send. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const field = (k: keyof Form, label: string, id: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={f?.[k] ?? ""} onChange={(e) => setF((x) => (x ? { ...x, [k]: e.target.value } : x))} className="h-11 rounded-[12px]" {...extra} />
    </div>
  );

  return (
    <div className="grid gap-6">
      <header className="max-w-2xl">
        <p className="text-[13px] font-medium text-muted-foreground">Creator Partnership Program · {data.ref}</p>
        <h1 className="display mt-3 text-balance text-[clamp(2.1rem,5.5vw,3.25rem)] leading-[1.08]">Partner portal</h1>
        <p className="mt-4 text-pretty text-[17px] leading-relaxed text-muted-foreground">
          {data.firstName ? `Welcome, ${data.firstName}. ` : ""}Your referral link, the content you agreed to and a place to submit each published post.
        </p>
        <p className="mt-4 inline-flex min-h-8 items-center gap-2 rounded-full bg-secondary px-3 text-[13px] font-medium">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-lime" />
          Status: {data.status}
        </p>
      </header>

      {data.benefit && (
        <section aria-labelledby="benefit-h" className={card}>
          <h2 id="benefit-h" className="text-[17px] font-semibold tracking-tight">Your complimentary plan</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">Sponsored by the partnership</p>
          <p className="mt-4 text-[1.35rem] font-semibold tracking-tight">{data.benefit.plan}</p>
          <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">{benefitLine(data.benefit)}</p>
        </section>
      )}

      <section aria-labelledby="link-h" className={card}>
        <h2 id="link-h" className="text-[17px] font-semibold tracking-tight">Your referral link</h2>
        <p className="mb-4 mt-1 text-[14px] leading-relaxed text-muted-foreground">Share it in your posts, bio or description. Visits and signups through it are credited to you.</p>
        {data.link ? <CopyLink link={data.link} /> : <p className="text-[15px] text-muted-foreground">Your link is being set up. Check back soon.</p>}
        <dl className="mt-6 grid grid-cols-2 gap-3">
          {([["Visits", data.counts.visits], ["Signups", data.counts.signups]] as const).map(([k, v]) => (
            <div key={k} className="rounded-[16px] bg-secondary/50 p-4">
              <dt className="text-[13px] font-medium text-muted-foreground">{k}</dt>
              <dd className="mt-1 text-[1.6rem] font-semibold leading-none tabular-nums">{nf.format(v)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[13px] leading-normal text-muted-foreground">Tracked from your link, consent-respecting, may undercount.</p>
      </section>

      <section aria-labelledby="del-h" className={card}>
        <h2 id="del-h" className="text-[17px] font-semibold tracking-tight">Content you agreed to</h2>
        <p role="status" className="mt-1 text-[14px] text-muted-foreground">{saved}</p>
        {items.length === 0 ? (
          <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">The team will add each piece here with its due date. You will get an email when they do.</p>
        ) : (
          <ul className="mt-4 divide-y divide-foreground/[0.08]">
            {items.map((d) => {
              const closed = d.status === "verified" || d.status === "missed";
              return (
                <li key={d.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium [overflow-wrap:anywhere]">{d.title}</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      {[PARTNER_PLATFORM_LABEL[d.platform as PartnerPlatform] ?? d.platform, d.format, d.dueAt ? `Due ${fmtDay(d.dueAt)}` : "", DELIVERABLE_STATUS_LABEL[d.status as DeliverableStatus] ?? d.status].filter(Boolean).join(" · ")}
                    </p>
                    {d.url && (
                      <a href={d.url} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 inline-flex min-h-8 items-center gap-1 text-[13px] font-medium underline underline-offset-4">
                        View the post <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    )}
                  </div>
                  {!closed && (
                    <Button type="button" variant={d.url ? "outline" : "lime"} onClick={() => { setErr(""); setF(blank(d)); setOpen(d); }} aria-label={`${d.url ? "Update link" : "Submit link"} for ${d.title}`}>
                      {d.url ? "Update link" : "Submit link"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={!!open}
        onOpenChange={(o) => !o && !busy && setOpen(null)}
        title={open ? `Submit link: ${open.title}` : "Submit link"}
        body="Paste the link to the published post. Numbers are optional; the team checks them on the platform."
        confirmLabel="Submit link"
        cancelLabel="Cancel"
        tone="primary"
        size="wide"
        busy={busy}
        extra={
          <div className="mt-4 grid gap-3">
            {field("url", "Post link", ids.url, { type: "url", inputMode: "url", placeholder: "https://www.instagram.com/reel/...", autoComplete: "url", required: true, "aria-invalid": !!err || undefined, "aria-describedby": err ? `${ids.url}-err` : undefined })}
            {err && <p id={`${ids.url}-err`} className="text-[13px] text-[hsl(0_72%_38%)] dark:text-destructive">{err}</p>}
            {field("publishedAt", "Published on", ids.date, { type: "date" })}
            <div>
              <Label htmlFor={ids.note}>Note for the team (optional)</Label>
              <Textarea id={ids.note} rows={2} maxLength={1000} value={f?.note ?? ""} onChange={(e) => setF((x) => (x ? { ...x, note: e.target.value } : x))} className="rounded-[12px]" />
            </div>
            <fieldset className="grid grid-cols-2 gap-3">
              <legend className="mb-2 text-[13px] font-medium text-muted-foreground">Numbers so far (optional)</legend>
              {field("views", "Views", ids.views, { inputMode: "numeric" })}
              {field("reach", "Reach", ids.reach, { inputMode: "numeric" })}
              {field("likes", "Likes", ids.likes, { inputMode: "numeric" })}
              {field("comments", "Comments", ids.comments, { inputMode: "numeric" })}
            </fieldset>
          </div>
        }
        onConfirm={() => void submit()}
      />
    </div>
  );
}
