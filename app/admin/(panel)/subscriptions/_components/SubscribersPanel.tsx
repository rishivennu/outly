"use client";
import { useEffect, useState } from "react";
import { adminApi } from "@/lib/client/admin-api";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Card, CardTitle, Empty, Pill, STATUS_TONE, Table, fmtDate } from "@/components/admin/ui";
import { useToast } from "@/components/shared/Toast";
import { intervalLabel } from "@/lib/billing/money";
import { chip, inr, MarginBadge, money, TIER_LABEL, useDebounced } from "./shared";

type Row = { subscriptionId: string; userId: string; email: string; name: string | null; plan: string; planSlug: string; tier: string; priceMinor: number; currency: string; interval: string; status: string; currentPeriodEnd: string; pausedUntil: string | null; createdAt: string; policyVersion: string | null };
type Event = { at: string; kind: string; title: string; detail?: string; tone?: "ok" | "warn" | "bad" | "muted" };
type Month = { month: string; tier: string; revenueMinor: number; feeMinor: number; costMinor: number; budgetMinor: number; margin: number | null };
type History = { user: { id: string; email: string; name: string | null; phoneVerified: boolean; createdAt: string; founding: { no: number; pct: number | null } | null }; months: Month[]; timeline: Event[] };

const TIER_FILTERS = ["", "intro", "standard", "legacy", "founding"] as const;
const PAGE = 50;

export function SubscribersPanel({ target }: { target: number }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<string>("");
  const [skip, setSkip] = useState(0);
  const [data, setData] = useState<{ rows: Row[]; total: number } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [hist, setHist] = useState<History | null>(null);
  const dq = useDebounced(q, 300);

  useEffect(() => {
    const p = new URLSearchParams({ skip: String(skip), take: String(PAGE) });
    if (dq.trim()) p.set("q", dq.trim());
    if (tier) p.set("tier", tier);
    adminApi<{ rows: Row[]; total: number }>(`/api/admin/subscriptions/subscribers?${p}`).then(setData).catch((e: Error) => toast(e.message, "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq, tier, skip]);

  async function show(userId: string) {
    if (open === userId) {
      setOpen(null);
      return;
    }
    setOpen(userId);
    setHist(null);
    try {
      setHist(await adminApi<History>(`/api/admin/subscriptions/subscribers/${encodeURIComponent(userId)}`));
    } catch (e) {
      toast((e as Error).message, "error");
      setOpen(null);
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Card>
        <CardTitle hint="Every subscription with the tier and the price it was snapshotted at. Editing the policy never changes these.">Subscribers</CardTitle>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <Label htmlFor="subs-q">Search by email</Label>
            <Input id="subs-q" type="search" value={q} onChange={(e) => { setQ(e.target.value); setSkip(0); }} placeholder="name@example.com" autoComplete="off" />
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by tier">
            {TIER_FILTERS.map((t) => (
              <button key={t || "all"} type="button" aria-pressed={tier === t} onClick={() => { setTier(t); setSkip(0); }} className={chip(tier === t)}>
                {t ? TIER_LABEL[t] : "All tiers"}
              </button>
            ))}
          </div>
        </div>
        {!data ? (
          <p className="text-[13.5px] text-muted-foreground" role="status">Loading subscribers</p>
        ) : !data.rows.length ? (
          <Empty title="No subscribers match" body="Try another email or tier." />
        ) : (
          <>
            <Table label="Subscribers" head={["Email", "Plan", "Tier", "Price", "Status", "Renews", <span key="a" className="sr-only">History</span>]} minWidth={760}>
              {data.rows.map((r) => (
                <tr key={r.subscriptionId}>
                  <td className="min-w-0 break-words">{r.email}</td>
                  <td>{r.plan}</td>
                  <td><Pill tone={r.tier === "intro" ? "lime" : r.tier === "founding" ? "info" : "muted"}>{TIER_LABEL[r.tier] ?? r.tier}</Pill></td>
                  <td className="tabular">{money(r.priceMinor, r.currency)}{intervalLabel(r.interval)}</td>
                  <td><Pill tone={STATUS_TONE[r.status] ?? "muted"}>{r.pausedUntil && new Date(r.pausedUntil) > new Date() ? "paused" : r.status}</Pill></td>
                  <td>{fmtDate(r.currentPeriodEnd)}</td>
                  <td>
                    <Button type="button" size="sm" variant="ghost" className="rounded-full" aria-expanded={open === r.userId} aria-controls={`hist-${r.userId}`} onClick={() => show(r.userId)}>
                      {open === r.userId ? "Hide history" : "History"}
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted-foreground">
              <span className="tabular">{skip + 1} to {Math.min(skip + PAGE, data.total)} of {data.total}</span>
              <span className="flex gap-2">
                <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE))}>Previous</Button>
                <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={skip + PAGE >= data.total} onClick={() => setSkip(skip + PAGE)}>Next</Button>
              </span>
            </div>
          </>
        )}
      </Card>
      {open && (
        <Card id={`hist-${open}`} aria-live="polite">
          {!hist ? (
            <p className="text-[13.5px] text-muted-foreground" role="status">Loading history</p>
          ) : (
            <HistoryView h={hist} target={target} />
          )}
        </Card>
      )}
    </div>
  );
}

function HistoryView({ h, target }: { h: History; target: number }) {
  return (
    <>
      <CardTitle hint={`Joined ${fmtDate(h.user.createdAt)}. Phone ${h.user.phoneVerified ? "verified" : "not verified"}.${h.user.founding ? ` Founding member #${h.user.founding.no} (${h.user.founding.pct ?? 0}% off).` : ""}`}>
        <span className="break-words">{h.user.email}</span>
      </CardTitle>
      {h.months.length > 0 && (
        <div className="mb-5">
          <h3 className="mb-2 text-[13px] font-semibold">Monthly economics</h3>
          <Table label="Monthly economics" head={["Month", "Tier", "Net revenue", "Fees", "Cost", "Budget", "Margin"]} minWidth={620}>
            {h.months.map((m) => (
              <tr key={m.month}>
                <td className="tabular">{m.month}</td>
                <td>{TIER_LABEL[m.tier] ?? (m.tier || "n/a")}</td>
                <td className="tabular">{inr(m.revenueMinor)}</td>
                <td className="tabular">{inr(m.feeMinor)}</td>
                <td className="tabular">{inr(m.costMinor)}</td>
                <td className="tabular">{m.budgetMinor ? inr(m.budgetMinor) : "None"}</td>
                <td><MarginBadge margin={m.margin} target={target} /></td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      <h3 className="mb-2 text-[13px] font-semibold">Timeline</h3>
      {!h.timeline.length ? (
        <p className="text-[13.5px] text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ol className="grid gap-3 border-l border-border pl-4">
          {h.timeline.map((e, i) => (
            <li key={i} className="relative min-w-0">
              <span aria-hidden className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${e.tone === "ok" ? "bg-success" : e.tone === "bad" ? "bg-destructive" : e.tone === "warn" ? "bg-warning" : "bg-muted-foreground/50"}`} />
              <p className="text-[13.5px] font-medium">{e.title}</p>
              <p className="break-words text-[12.5px] text-muted-foreground">
                <time dateTime={e.at}>{fmtDate(e.at, true)}</time> · {e.kind}{e.detail ? ` · ${e.detail}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
