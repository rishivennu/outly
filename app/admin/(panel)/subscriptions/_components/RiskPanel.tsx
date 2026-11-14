"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { adminApi } from "@/lib/client/admin-api";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";
import { Card, CardTitle, Empty, Pill, fmtDate } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/Toast";
import { chip } from "./shared";

type Flag = { id: string; userId: string | null; email: string | null; score: number; level: string; action: string; status: string; context: string; reasons: { code: string; weight: number; detail?: string }[]; related: { id: string; email: string | null }[]; ticket: { id: string; ref: string; status: string } | null; note: string | null; reviewedBy: string | null; reviewedAt: string | null; createdAt: string };
type Data = { rows: Flag[]; counts: Record<string, number> };

const STATUSES = [["open", "Open"], ["verified", "Verified"], ["cleared", "Cleared"], ["confirmed", "Confirmed"], ["all", "All"]] as const;
const ACTION_LABEL: Record<string, string> = { none: "No action", verify: "Must verify phone or email", deny_offer: "No trial or first-time price" };

export function RiskPanel() {
  const toast = useToast();
  const [status, setStatus] = useState<string>("open");
  const [d, setD] = useState<Data | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [ask, setAsk] = useState<{ id: string; action: "clear" | "confirm" } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => adminApi<Data>(`/api/admin/subscriptions/risk?status=${status}`).then(setD).catch((e: Error) => toast(e.message, "error"));
  useEffect(() => {
    setD(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function act(id: string, action: "clear" | "confirm" | "note") {
    setBusy(true);
    try {
      await adminApi(`/api/admin/subscriptions/risk/${encodeURIComponent(id)}`, { method: "POST", json: { action, note: notes[id]?.trim() || undefined } });
      toast(action === "clear" ? "Cleared. Trial and first-time price are available again." : action === "confirm" ? "Confirmed. The account stays on the returning price." : "Note saved");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      setAsk(null);
    }
  }

  return (
    <Card>
      <CardTitle hint="Each decision the anti-abuse check made, strongest first. An IP address alone never flags anyone. Appeals arrive as support tickets linked here.">Risk flags</CardTitle>
      <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Filter by status">
        {STATUSES.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)} className={chip(status === k)}>
            {label}
            {k !== "all" && d && <span className="tabular rounded-full bg-foreground/[0.08] px-1.5 text-[11.5px]">{d.counts[k] ?? 0}</span>}
          </button>
        ))}
      </div>
      {!d ? (
        <p className="text-[13.5px] text-muted-foreground" role="status">Loading flags</p>
      ) : !d.rows.length ? (
        <Empty title="Nothing to review" body="New flags land here when someone looks like a repeat trial or first-time offer." />
      ) : (
        <ul className="grid gap-3">
          {d.rows.map((f) => (
            <li key={f.id} className="min-w-0 rounded-[20px] bg-secondary/30 p-4 hairline">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-auto min-w-0 break-words text-[14px] font-semibold">{f.email ?? "Deleted account"}</span>
                <Pill tone={f.level === "high" ? "bad" : f.level === "medium" ? "warn" : "muted"}>{f.level} risk, score {f.score}</Pill>
                <Pill tone={f.status === "open" ? "lime" : "muted"}>{f.status}</Pill>
              </div>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                {ACTION_LABEL[f.action] ?? f.action} · at {f.context} · {fmtDate(f.createdAt, true)}
                {f.reviewedAt ? ` · reviewed by ${f.reviewedBy ?? "admin"} ${fmtDate(f.reviewedAt, true)}` : ""}
              </p>
              {f.reasons.length > 0 && (
                <ul className="mt-2 grid gap-1 text-[13px]" aria-label="Reasons">
                  {f.reasons.map((r, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="tabular w-10 shrink-0 text-right font-semibold">{r.weight > 0 ? `+${r.weight}` : r.weight}</span>
                      <span className="min-w-0 break-words">{r.detail || r.code}</span>
                    </li>
                  ))}
                </ul>
              )}
              {f.related.length > 0 && (
                <p className="mt-2 break-words text-[12.5px] text-muted-foreground">Matches: {f.related.map((r) => r.email ?? "deleted account").join(", ")}</p>
              )}
              {f.ticket && (
                <p className="mt-2 text-[13px]">
                  Appeal: <Link href={`/admin/tickets/${f.ticket.id}`} className="font-semibold underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{f.ticket.ref}</Link> ({f.ticket.status})
                </p>
              )}
              <div className="mt-3">
                <Label htmlFor={`note-${f.id}`}>Note</Label>
                <Textarea id={`note-${f.id}`} rows={2} maxLength={1000} value={notes[f.id] ?? f.note ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [f.id]: e.target.value }))} placeholder="Why you cleared or confirmed it" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="lime" className="rounded-full" disabled={busy || f.status === "cleared"} onClick={() => setAsk({ id: f.id, action: "clear" })}>Clear</Button>
                <Button type="button" size="sm" variant="danger" className="rounded-full" disabled={busy || f.status === "confirmed"} onClick={() => setAsk({ id: f.id, action: "confirm" })}>Confirm</Button>
                <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={busy || !(notes[f.id] ?? "").trim()} onClick={() => act(f.id, "note")}>Save note</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!ask}
        onOpenChange={(o) => !o && setAsk(null)}
        tone={ask?.action === "clear" ? "primary" : "danger"}
        title={ask?.action === "clear" ? "Clear this flag?" : "Confirm this flag?"}
        body={ask?.action === "clear" ? "The person gets the trial and first-time price back, unless they already used them." : "The person stays on the returning price with no trial. They can still appeal."}
        confirmLabel={ask?.action === "clear" ? "Clear flag" : "Confirm flag"}
        busy={busy}
        onConfirm={() => ask && act(ask.id, ask.action)}
      />
    </Card>
  );
}
