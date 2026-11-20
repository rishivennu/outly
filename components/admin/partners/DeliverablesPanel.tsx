"use client";
import { useCallback, useEffect, useId, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Card, CardTitle, Empty, LoadingState, Pill, Table, fmtDate, type Tone } from "@/components/admin/ui";
import { adminApi } from "@/lib/client/admin-api";
import { DELIVERABLE_APPROVALS, DELIVERABLE_APPROVAL_LABEL } from "@/lib/partners/offer-core";
import { DELIVERABLE_STATUS_LABEL, PARTNER_PLATFORMS, PARTNER_PLATFORM_LABEL, type DeliverableStatus, type PartnerPlatform } from "@/lib/partners/types";

type Approval = (typeof DELIVERABLE_APPROVALS)[number];
type Deliverable = {
  id: string; title: string; platform: string; format: string; dueAt: string | null; publishedAt: string | null; url: string;
  status: string; approval: string; adminNote: string; creatorNote: string;
  views: number | null; reach: number | null; likes: number | null; comments: number | null; clicks: number | null;
};
const METRICS = ["views", "reach", "likes", "comments", "clicks"] as const;
type Metric = (typeof METRICS)[number];
const REVIEW_STATUSES: DeliverableStatus[] = ["published", "verified", "missed"];
const STATUS_TONE: Record<string, Tone> = { planned: "muted", submitted: "info", published: "lime", verified: "ok", missed: "bad" };
const APPROVAL_TONE: Record<string, Tone> = { none: "muted", pending: "warn", approved: "ok", changes: "bad" };

const select = "h-11 w-full rounded-[12px] border border-foreground/[0.08] bg-secondary/50 px-3 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const day = (d: string | null) => (d ? d.slice(0, 10) : "");
const nf = new Intl.NumberFormat("en-IN");

type Draft = { title: string; platform: PartnerPlatform; format: string; dueAt: string; approval: Approval };
type Review = { status: DeliverableStatus; approval: Approval; adminNote: string; url: string; publishedAt: string } & Record<Metric, string>;
type Ask = { kind: "edit"; d: Deliverable | null } | { kind: "review"; d: Deliverable } | { kind: "delete"; d: Deliverable } | null;

const draftOf = (d: Deliverable | null): Draft =>
  d ? { title: d.title, platform: d.platform as PartnerPlatform, format: d.format, dueAt: day(d.dueAt), approval: d.approval as Approval } : { title: "", platform: "instagram", format: "", dueAt: "", approval: "none" };
const reviewOf = (d: Deliverable): Review => ({
  status: (REVIEW_STATUSES as string[]).includes(d.status) ? (d.status as DeliverableStatus) : "verified",
  approval: d.approval as Approval, adminNote: d.adminNote, url: d.url, publishedAt: day(d.publishedAt),
  ...(Object.fromEntries(METRICS.map((m) => [m, d[m] == null ? "" : String(d[m])])) as Record<Metric, string>),
});
function reviewBody(r: Review) {
  const metrics: Partial<Record<Metric, number>> = {};
  for (const m of METRICS) {
    const n = Number(r[m].replace(/[, ]/g, ""));
    if (r[m].trim() !== "" && Number.isFinite(n) && n >= 0) metrics[m] = Math.floor(n);
  }
  return { status: r.status, approval: r.approval, adminNote: r.adminNote, url: r.url, publishedAt: r.publishedAt || null, ...metrics };
}
const metricLine = (d: Deliverable) =>
  METRICS.filter((m) => d[m] != null).map((m) => `${nf.format(d[m] as number)} ${m}`).join(", ") || "None yet";

export default function DeliverablesPanel({ applicationId, status }: { applicationId: string; status: string; email: string }) {
  const toast = useToast();
  const fid = useId();
  const base = `/api/admin/partners/${applicationId}/deliverables`;
  const [rows, setRows] = useState<Deliverable[] | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [draft, setDraft] = useState<Draft>(draftOf(null));
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const canAdd = ["offer_accepted", "active", "paused", "completed"].includes(status);

  const load = useCallback(async () => {
    try {
      setRows((await adminApi<{ deliverables: Deliverable[] }>(base)).deliverables);
    } catch (e) {
      setRows([]);
      toast((e as Error).message, "error");
    }
  }, [base, toast]);
  useEffect(() => void load(), [load]);

  const openEdit = (d: Deliverable | null) => { setDraft(draftOf(d)); setAsk({ kind: "edit", d }); };
  const openReview = (d: Deliverable) => { setReview(reviewOf(d)); setAsk({ kind: "review", d }); };
  const setD = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((x) => ({ ...x, [k]: v }));
  const setR = <K extends keyof Review>(k: K, v: Review[K]) => setReview((x) => (x ? { ...x, [k]: v } : x));

  async function confirm() {
    if (!ask) return;
    if (ask.kind === "edit" && draft.title.trim().length < 2) return toast("Give it a short title.", "error");
    setBusy(true);
    try {
      if (ask.kind === "delete") {
        await adminApi(`${base}/${ask.d.id}`, { method: "DELETE" });
        toast("Deliverable removed.");
      } else if (ask.kind === "review" && review) {
        await adminApi(`${base}/${ask.d.id}`, { method: "PATCH", json: reviewBody(review) });
        toast("Review saved.");
      } else if (ask.kind === "edit") {
        const json = { ...draft, dueAt: draft.dueAt || null };
        await (ask.d ? adminApi(`${base}/${ask.d.id}`, { method: "PATCH", json }) : adminApi(base, { method: "POST", json }));
        toast(ask.d ? "Deliverable updated." : "Deliverable added. The creator sees it in their portal.");
      }
      setAsk(null);
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const editForm = (
    <div className="mt-3 grid gap-3">
      <div>
        <Label htmlFor={`${fid}-t`}>Title</Label>
        <Input id={`${fid}-t`} value={draft.title} maxLength={160} onChange={(e) => setD("title", e.target.value)} placeholder="Launch Reel" className="h-11 rounded-[12px]" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${fid}-p`}>Platform</Label>
          <select id={`${fid}-p`} value={draft.platform} onChange={(e) => setD("platform", e.target.value as PartnerPlatform)} className={select}>
            {PARTNER_PLATFORMS.map((p) => <option key={p} value={p}>{PARTNER_PLATFORM_LABEL[p]}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor={`${fid}-f`}>Format</Label>
          <Input id={`${fid}-f`} value={draft.format} maxLength={120} onChange={(e) => setD("format", e.target.value)} placeholder="60 second Reel" className="h-11 rounded-[12px]" />
        </div>
        <div>
          <Label htmlFor={`${fid}-d`}>Due date</Label>
          <Input id={`${fid}-d`} type="date" value={draft.dueAt} onChange={(e) => setD("dueAt", e.target.value)} className="h-11 rounded-[12px]" />
        </div>
        <div>
          <Label htmlFor={`${fid}-a`}>Approval before posting</Label>
          <select id={`${fid}-a`} value={draft.approval} onChange={(e) => setD("approval", e.target.value as Approval)} className={select}>
            {DELIVERABLE_APPROVALS.map((a) => <option key={a} value={a}>{DELIVERABLE_APPROVAL_LABEL[a]}</option>)}
          </select>
        </div>
      </div>
    </div>
  );

  const reviewForm = review && (
    <div className="mt-3 grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${fid}-rs`}>Status</Label>
          <select id={`${fid}-rs`} value={review.status} onChange={(e) => setR("status", e.target.value as DeliverableStatus)} className={select}>
            {REVIEW_STATUSES.map((s) => <option key={s} value={s}>{DELIVERABLE_STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor={`${fid}-ra`}>Approval</Label>
          <select id={`${fid}-ra`} value={review.approval} onChange={(e) => setR("approval", e.target.value as Approval)} className={select}>
            {DELIVERABLE_APPROVALS.map((a) => <option key={a} value={a}>{DELIVERABLE_APPROVAL_LABEL[a]}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor={`${fid}-ru`}>Post link</Label>
          <Input id={`${fid}-ru`} type="url" value={review.url} maxLength={500} onChange={(e) => setR("url", e.target.value)} placeholder="https://" className="h-11 rounded-[12px]" />
        </div>
        <div>
          <Label htmlFor={`${fid}-rp`}>Published on</Label>
          <Input id={`${fid}-rp`} type="date" value={review.publishedAt} onChange={(e) => setR("publishedAt", e.target.value)} className="h-11 rounded-[12px]" />
        </div>
      </div>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-muted-foreground">Results (leave blank if unknown)</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {METRICS.map((m) => (
            <div key={m}>
              <Label htmlFor={`${fid}-m-${m}`} className="capitalize">{m}</Label>
              <Input id={`${fid}-m-${m}`} inputMode="numeric" value={review[m]} onChange={(e) => setR(m, e.target.value)} className="h-11 rounded-[12px] tabular-nums" />
            </div>
          ))}
        </div>
      </fieldset>
      <div>
        <Label htmlFor={`${fid}-rn`}>Internal note (the creator never sees this)</Label>
        <Textarea id={`${fid}-rn`} value={review.adminNote} maxLength={2000} rows={3} onChange={(e) => setR("adminNote", e.target.value)} />
      </div>
    </div>
  );

  const copy =
    ask?.kind === "delete"
      ? { title: "Remove this deliverable?", body: `"${ask.d.title}" disappears from the creator's portal. The audit trail keeps a record.`, label: "Remove", tone: "danger" as const }
      : ask?.kind === "review"
        ? { title: "Review deliverable", body: ask.d.creatorNote ? `Creator's note: ${ask.d.creatorNote}` : "Check the post, then record what you found.", label: "Save review", tone: "primary" as const }
        : { title: ask?.kind === "edit" && ask.d ? "Edit deliverable" : "Add deliverable", body: "The creator sees the title, platform, format and due date in their portal.", label: ask?.kind === "edit" && ask.d ? "Save" : "Add", tone: "primary" as const };

  return (
    <Card>
      <CardTitle
        hint="What the creator agreed to publish, and what came of it."
        action={canAdd && <Button type="button" size="sm" variant="lime" onClick={() => openEdit(null)}><Plus className="h-4 w-4" aria-hidden="true" /> Add</Button>}
      >
        Deliverables
      </CardTitle>
      {rows === null ? (
        <LoadingState lines={2} label="Loading deliverables" />
      ) : rows.length === 0 ? (
        <Empty title="No deliverables yet" body={canAdd ? "Add each post the creator agreed to, with its due date." : "Deliverables open once the creator accepts an offer."} />
      ) : (
        <Table label="Deliverables" head={["Title", "Due", "Status", "Approval", "Results", <span key="a" className="sr-only">Actions</span>]}>
          {rows.map((d) => (
            <tr key={d.id}>
              <td>
                <p className="font-medium">{d.title}</p>
                <p className="text-[12px] text-muted-foreground">
                  {[PARTNER_PLATFORM_LABEL[d.platform as PartnerPlatform] ?? d.platform, d.format].filter(Boolean).join(" · ")}
                  {d.url && <> · <a href={d.url} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">Open post<span className="sr-only"> (opens in a new tab)</span></a></>}
                </p>
              </td>
              <td className="whitespace-nowrap">{d.dueAt ? fmtDate(d.dueAt) : "No date"}{d.publishedAt && <p className="text-[12px] text-muted-foreground">Posted {fmtDate(d.publishedAt)}</p>}</td>
              <td><Pill tone={STATUS_TONE[d.status] ?? "muted"}>{DELIVERABLE_STATUS_LABEL[d.status as DeliverableStatus] ?? d.status}</Pill></td>
              <td><Pill tone={APPROVAL_TONE[d.approval] ?? "muted"}>{DELIVERABLE_APPROVAL_LABEL[d.approval as Approval] ?? d.approval}</Pill></td>
              <td className="text-[12.5px] tabular-nums text-muted-foreground">{metricLine(d)}</td>
              <td>
                <div className="flex flex-wrap justify-end gap-1.5">
                  <Button type="button" size="sm" variant={d.status === "submitted" ? "lime" : "subtle"} disabled={busy} onClick={() => openReview(d)}>Review</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => openEdit(d)} aria-label={`Edit ${d.title}`}>Edit</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setAsk({ kind: "delete", d })} aria-label={`Remove ${d.title}`}>Remove</Button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <ConfirmDialog
        open={!!ask}
        onOpenChange={(o) => !o && !busy && setAsk(null)}
        title={copy.title}
        body={copy.body}
        confirmLabel={copy.label}
        cancelLabel="Cancel"
        tone={copy.tone}
        busy={busy}
        size={ask?.kind === "review" ? "wide" : "default"}
        extra={ask?.kind === "edit" ? editForm : ask?.kind === "review" ? reviewForm : undefined}
        onConfirm={() => void confirm()}
      />
    </Card>
  );
}
