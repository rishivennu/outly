"use client";
import { useCallback, useEffect, useId, useState } from "react";
import { HardDrive, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import { ApiError } from "@/lib/client/api";
import { fmtBytes, fmtDay } from "@/lib/storage/quota-core";
import type { QuotaView } from "@/components/billing/QuotaCard";

type FileLine = { id: string; name: string; bytes: number; uploadedAt: string; deletedAt: string | null; purgeAt: string | null };
type Card = {
  user: { id: string; email: string; name: string };
  plan: { name: string; slug: string; source: string; status: string; endsAt: string | null };
  cycle: { key: string; startsAt: string; resetAt: string };
  usage: QuotaView;
  counts: { files: number; trash: number; drafts: number };
  largest: FileLine[];
  recent: FileLine[];
  deletions: { trash: FileLine[]; purges: { key: string; done: boolean; attempts: number; lastError: string | null; at: string }[] };
  history: { id: string; plan: string; status: string; provider: string; startedAt: string; canceledAt: string | null; endsAt: string }[];
  cycles: { key: string; startsAt: string; endsAt: string; plan: string; uploadedBytes: number; allowanceBytes: number; storedBytes: number }[];
  adjustments: { id: string; kind: string; bytes: number; actor: string; note: string; at: string }[];
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function Files({ title, list, empty }: { title: string; list: FileLine[]; empty: string }) {
  return (
    <div className="min-w-0">
      <h4 className="text-[13px] font-semibold">{title}</h4>
      {list.length === 0 ? (
        <p className="mt-1 text-[12.5px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {list.map((f) => (
            <li key={f.id} className="flex items-baseline justify-between gap-2 text-[12.5px]">
              <span className="min-w-0 truncate">{f.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{fmtBytes(f.bytes)} · {fmtDay(f.deletedAt ?? f.uploadedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * R1209: one customer's storage and monthly upload allowance (GET /api/storage/admin), with a manual change for
 * this cycle only (extra allowance or reset), written to the audit log with before and after.
 */
export function StoragePanel({ userId, email }: { userId?: string; email?: string }) {
  const id = useId();
  const toast = useToast();
  const [who, setWho] = useState(email ?? "");
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mb, setMb] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async (q: { userId?: string; email?: string }) => {
    const qs = q.userId ? `userId=${encodeURIComponent(q.userId)}` : `email=${encodeURIComponent(q.email ?? "")}`;
    try {
      setCard(await adminApi<Card>(`/api/storage/admin?${qs}`));
      setError(null);
    } catch (e) {
      setCard(null);
      setError(e instanceof ApiError ? e.message : "Couldn't load storage for that account.");
    }
  }, []);
  useEffect(() => { if (userId) void load({ userId }); }, [load, userId]);

  const adjust = async (action: "extra" | "reset") => {
    if (!card) return;
    if (note.trim().length < 3) return setError("Say why, in a few words, before changing the allowance.");
    const n = Number(mb);
    if (action === "extra" && (!Number.isInteger(n) || n < 1)) return setError("Give the extra allowance as a whole number of MB.");
    setBusy(true);
    try {
      const r = await adminApi<{ storage: Card }>("/api/storage/admin", { method: "POST", json: { userId: card.user.id, action, ...(action === "extra" ? { mb: n } : {}), note: note.trim() } });
      setCard(r.storage);
      setNote("");
      setMb("");
      setError(null);
      toast(action === "extra" ? `Added ${fmtBytes(n * 1048576)} for this cycle. Logged.` : "This cycle's uploads were reset to zero. Logged.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't go through. Nothing changed.");
    } finally {
      setBusy(false);
    }
  };

  const m = card?.usage.monthly;
  const s = card?.usage.storage;
  return (
    <section aria-labelledby={`${id}-h`} className="cx-panel rounded-[24px] p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <span aria-hidden className="cx-badge grid size-10 shrink-0 place-items-center rounded-full"><HardDrive className="size-[18px]" strokeWidth={1.8} /></span>
        <div className="min-w-0">
          <h3 id={`${id}-h`} className="text-[16px] font-semibold leading-[1.3]">Storage</h3>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">Files kept, this cycle's uploads, and manual changes</p>
        </div>
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (who.trim()) void load({ email: who.trim() });
        }}
      >
        <div className="min-w-0 flex-1">
          <Label htmlFor={`${id}-q`}>Customer email</Label>
          <Input id={`${id}-q`} type="email" value={who} onChange={(e) => setWho(e.target.value)} placeholder={card?.user.email ?? "name@example.com"} />
        </div>
        <Button type="submit" variant="outline" className="min-h-11" aria-label="Look up storage"><Search className="h-4 w-4" aria-hidden /></Button>
      </form>
      {error && <p role="alert" className="mt-3 text-[13px] text-[hsl(0_72%_38%)] dark:text-destructive">{error}</p>}
      {card && (
        <>
          <p className="mt-4 text-[13px] font-semibold [overflow-wrap:anywhere]">{card.user.name || card.user.email}</p>
          <dl className="mt-1 divide-y divide-[hsl(var(--cx-edge))]">
            <Row label="Plan" value={`${card.plan.name} (${card.plan.source})`} />
            <Row label="Subscription" value={card.plan.status + (card.plan.endsAt ? `, until ${fmtDay(card.plan.endsAt)}` : "")} />
            <Row label="Stored" value={fmtBytes(card.usage.storedBytes)} />
            <Row label="Capacity" value={s ? (s.unlimited ? "No cap" : fmtBytes(s.capacityBytes)) : "Not limited by storage"} />
            <Row label="Uploaded this cycle" value={m ? (m.unlimited ? `${fmtBytes(m.usedBytes)}, no cap` : `${fmtBytes(m.usedBytes)} of ${fmtBytes(m.allowanceBytes)}`) : "No monthly allowance"} />
            {m && !m.unlimited && <Row label="Remaining" value={fmtBytes(m.remainingBytes)} />}
            <Row label="Next reset" value={fmtDay(card.cycle.resetAt)} />
            <Row label="Files" value={`${card.counts.files} (${card.counts.trash} in Trash)`} />
            <Row label="Drafts" value={card.counts.drafts} />
            <Row label="State" value={card.usage.state} />
          </dl>
          <div className="mt-4 grid gap-4">
            <Files title="Largest files" list={card.largest} empty="No files." />
            <Files title="Recent uploads" list={card.recent} empty="No uploads." />
            <Files title="Recently moved to Trash" list={card.deletions.trash} empty="Nothing in Trash." />
            <div>
              <h4 className="text-[13px] font-semibold">Plan history</h4>
              {card.history.length === 0 ? (
                <p className="mt-1 text-[12.5px] text-muted-foreground">Always on Free.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-[12.5px]">
                  {card.history.map((h) => (
                    <li key={h.id} className="flex justify-between gap-2">
                      <span>{h.plan} <span className="text-muted-foreground">({h.status})</span></span>
                      <span className="tabular-nums text-muted-foreground">{fmtDay(h.startedAt)}{h.canceledAt ? ` to ${fmtDay(h.canceledAt)}` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {card.cycles.length > 0 && (
              <div>
                <h4 className="text-[13px] font-semibold">Past cycles</h4>
                <ul className="mt-1 space-y-1 text-[12.5px]">
                  {card.cycles.map((c) => (
                    <li key={c.key} className="flex justify-between gap-2">
                      <span>{fmtDay(c.startsAt)} ({c.plan})</span>
                      <span className="tabular-nums text-muted-foreground">{fmtBytes(c.uploadedBytes)}{c.allowanceBytes ? ` of ${fmtBytes(c.allowanceBytes)}` : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <fieldset className="mt-5 space-y-3 rounded-2xl bg-secondary/40 p-4" disabled={busy}>
            <legend className="px-1 text-[13px] font-semibold">Manual change, this cycle only</legend>
            <div>
              <Label htmlFor={`${id}-note`}>Why (saved in the audit log)</Label>
              <Input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Support ticket, goodwill, bug" />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-32">
                <Label htmlFor={`${id}-mb`}>Extra MB</Label>
                <Input id={`${id}-mb`} inputMode="numeric" value={mb} onChange={(e) => setMb(e.target.value.replace(/\D/g, ""))} placeholder="500" />
              </div>
              <Button type="button" variant="outline" className="min-h-11" onClick={() => void adjust("extra")}>Add allowance</Button>
              <Button type="button" variant="outline" className="min-h-11" onClick={() => void adjust("reset")}>Reset this cycle</Button>
            </div>
            <p className="text-[12px] text-muted-foreground">Files are never touched. Reset gives back what was uploaded so far this cycle.</p>
            {card.adjustments.length > 0 && (
              <ul className="space-y-1 text-[12px] text-muted-foreground">
                {card.adjustments.map((a) => (
                  <li key={a.id}>{fmtDay(a.at)}: {a.kind === "extra" ? `+${fmtBytes(a.bytes)}` : `reset ${fmtBytes(a.bytes)}`} by {a.actor}{a.note ? `, ${a.note}` : ""}</li>
                ))}
              </ul>
            )}
          </fieldset>
        </>
      )}
    </section>
  );
}
