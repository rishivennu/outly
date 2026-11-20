"use client";
import { useCallback, useEffect, useState } from "react";
import { History, Infinity as InfinityIcon, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Sheet } from "@/components/shared/Sheet";
import { Skeleton } from "@/components/shared/Skeleton";
import { adminApi } from "@/lib/client/admin-api";
import { AI_FEATURES, AI_FEATURE_LABEL, type AiFeature } from "@/lib/ai/features";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Pill, fmtDate } from "./ui";
import { GRANT_TONE, featuresText } from "./AiAccessFormat";

type Features = "all" | AiFeature[];
type Grant = { id: string; features: Features; expiresAt: string | null; note: string; grantedBy: string; revokedAt: string | null; revokedBy: string | null; createdAt: string; state: "active" | "expired" | "revoked" };
export type AiAccess = {
  user: { id: string; name: string; email: string };
  plan: string;
  monthLimit: number;
  monthUsed: number;
  byFeature: { feature: AiFeature; count: number; unlimited: number }[];
  live: Grant | null;
  grants: Grant[];
  history: { id: string; actor: string; actorRole: string | null; action: string; note: string | null; createdAt: string }[];
};

const ACTION_LABEL: Record<string, string> = { "ai.grant": "Granted Unlimited AI Access", "ai.change": "Changed Unlimited AI Access", "ai.revoke": "Revoked Unlimited AI Access" };
const HINT: Partial<Record<AiFeature, string>> = { transcription: "Also lifts the monthly cap on AI-captioned videos." };
const PRESETS = [7, 30, 90];
const ease = "ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none";
const today = () => new Date().toISOString().slice(0, 10);

/** Admin: one person's AI usage this month, their limit, and Unlimited AI Access (grant, change, revoke, history). */
export function AiAccessPanel({ userId, canManage, onChanged }: { userId: string; canManage: boolean; onChanged?: () => void }) {
  const toast = useToast();
  const [acc, setAcc] = useState<AiAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "grant" | "revoke">(null);
  const [all, setAll] = useState(true);
  const [picked, setPicked] = useState<AiFeature[]>([]);
  const [mode, setMode] = useState<"permanent" | "days" | "until">("days");
  const [days, setDays] = useState(30);
  const [until, setUntil] = useState("");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<null | "grant" | "revoke">(null);
  const [revokeNote, setRevokeNote] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const a = await adminApi<AiAccess>(`/api/admin/ai-access?userId=${encodeURIComponent(userId)}`);
      setAcc(a);
      if (a.live) {
        setAll(a.live.features === "all");
        setPicked(a.live.features === "all" ? [] : a.live.features);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [userId]);
  useEffect(() => void load(), [load]);

  const features: Features = all ? "all" : picked;
  const ready = (all || picked.length > 0) && (mode !== "until" || (!!until && until >= today()));
  const toggle = (f: AiFeature) => setPicked((p) => (p.includes(f) ? p.filter((x) => x !== f) : [...p, f]));
  const duration = mode === "permanent" ? { kind: "permanent" } : mode === "days" ? { kind: "days", days } : { kind: "until", date: until };
  const durationText = mode === "permanent" ? "permanently" : mode === "days" ? `for ${days} days` : `until ${until}`;

  async function grant() {
    setBusy("grant");
    try {
      const r = await adminApi<{ access: AiAccess; changed: boolean }>("/api/admin/ai-access", { method: "POST", json: { userId, features, duration, note } });
      setAcc(r.access);
      setNote("");
      setConfirm(null);
      toast(r.changed ? "Unlimited AI Access updated." : "Unlimited AI Access granted. It works from their next AI request.");
      onChanged?.();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }
  async function revoke() {
    if (!acc?.live) return;
    setBusy("revoke");
    try {
      const r = await adminApi<{ access: AiAccess }>(`/api/admin/ai-access/${acc.live.id}`, { method: "PATCH", json: { action: "revoke", note: revokeNote } });
      setAcc(r.access);
      setConfirm(null);
      setRevokeNote("");
      toast("Unlimited AI Access revoked. Their plan limits apply again now.");
      onChanged?.();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p role="alert" className="text-[13.5px] text-destructive">{error}</p>;
  if (!acc) return <div className="grid gap-3" aria-busy="true"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>;

  const pct = acc.monthLimit > 0 ? Math.min(100, Math.round((acc.monthUsed / acc.monthLimit) * 100)) : 0;
  const total = acc.byFeature.reduce((s, r) => s + r.count, 0);
  return (
    <div className="grid min-w-0 gap-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-display text-[1.05rem] font-semibold">{acc.user.name}</p>
            <p className="truncate text-[13px] text-muted-foreground">{acc.user.email}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Pill tone="lime">{acc.plan}</Pill>
            {acc.live ? <Pill tone="ok"><InfinityIcon className="h-3.5 w-3.5" aria-hidden /> Unlimited AI</Pill> : <Pill>Plan limits</Pill>}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
          <div className="rounded-[18px] bg-secondary/40 p-3">
            <dt className="text-[12px] text-muted-foreground">AI requests this month</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{acc.monthLimit > 0 ? `${acc.monthUsed} of ${acc.monthLimit}` : `${acc.monthUsed}, no monthly limit`}</dd>
            {acc.monthLimit > 0 && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden>
                <div className={cn("h-full rounded-full", pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-warning" : "bg-lime")} style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
          <div className="rounded-[18px] bg-secondary/40 p-3">
            <dt className="text-[12px] text-muted-foreground">Unlimited AI Access</dt>
            <dd className="mt-0.5 font-semibold">{acc.live ? (acc.live.expiresAt ? `Until ${fmtDate(acc.live.expiresAt)}` : "Permanent") : "None"}</dd>
            {acc.live && <p className="mt-1 text-[12px] text-muted-foreground">{featuresText(acc.live.features)}</p>}
          </div>
        </dl>
        <p className="mt-4 text-[12px] font-semibold text-muted-foreground">Usage this month by feature</p>
        <ul className="mt-1.5 grid gap-1 text-[13px]">
          {acc.byFeature.map((r) => (
            <li key={r.feature} className="flex items-center justify-between gap-2">
              <span className="truncate">{AI_FEATURE_LABEL[r.feature]}</span>
              <span className="tabular-nums text-muted-foreground">{r.count}{r.unlimited ? ` (${r.unlimited} unlimited)` : ""}</span>
            </li>
          ))}
        </ul>
        {total === 0 && <p className="mt-1 text-[12px] text-muted-foreground">No AI calls counted this month yet.</p>}
      </Card>

      {canManage ? (
        <Card className="p-4 sm:p-5">
          <CardTitle hint={acc.live ? "Change what is covered or for how long. The change is logged." : "Lifts AI limits for the features you pick. Rate limits, file size limits and abuse checks still apply."}>
            <span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4" aria-hidden /> {acc.live ? "Change Unlimited AI Access" : "Grant Unlimited AI Access"}</span>
          </CardTitle>
          <fieldset disabled={!!busy} className="grid gap-4 disabled:opacity-60">
            <div role="group" aria-labelledby={`ai-feat-${userId}`}>
              <p id={`ai-feat-${userId}`} className="mb-2 text-[13px] font-medium">Features</p>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl bg-secondary/40 px-3">
                <input type="checkbox" className="h-5 w-5 accent-[hsl(var(--lime))]" checked={all} onChange={(e) => setAll(e.target.checked)} />
                <span className="text-[14px] font-medium">All AI features</span>
              </label>
              <div className={cn("mt-2 grid gap-2 transition-opacity duration-200 sm:grid-cols-2", ease, all && "opacity-60")}>
                {AI_FEATURES.map((f) => (
                  <label key={f} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl bg-secondary/40 px-3 py-2.5">
                    <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--lime))]" disabled={all} checked={all || picked.includes(f)} onChange={() => toggle(f)} />
                    <span className="min-w-0 text-[13.5px]">
                      {AI_FEATURE_LABEL[f]}
                      {HINT[f] && <span className="block text-[12px] text-muted-foreground">{HINT[f]}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p id={`ai-len-${userId}`} className="mb-2 text-[13px] font-medium">How long</p>
              <div role="radiogroup" aria-labelledby={`ai-len-${userId}`} className="grid grid-cols-3 gap-2">
                {(["days", "until", "permanent"] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cn("min-h-11 rounded-2xl text-[13.5px] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", ease, mode === m ? "bg-foreground text-background" : "bg-secondary/40 [@media(hover:hover)]:hover:bg-secondary")}>
                    {m === "days" ? "Duration" : m === "until" ? "Until a date" : "Permanent"}
                  </button>
                ))}
              </div>
              {mode === "days" && (
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Length">
                  {PRESETS.map((d) => (
                    <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={cn("min-h-11 min-w-[5.5rem] rounded-2xl px-3 text-[13.5px] tabular-nums transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", ease, days === d ? "bg-lime/20 font-semibold text-lime-ink" : "bg-secondary/40")}>
                      {d} days
                    </button>
                  ))}
                </div>
              )}
              {mode === "until" && (
                <div className="mt-2">
                  <Label htmlFor={`ai-until-${userId}`}>Ends on (end of that day, UTC)</Label>
                  <Input id={`ai-until-${userId}`} type="date" min={today()} value={until} onChange={(e) => setUntil(e.target.value)} />
                </div>
              )}
            </div>
            <div>
              <Label htmlFor={`ai-note-${userId}`}>Internal note</Label>
              <Input id={`ai-note-${userId}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Why, e.g. partner creator" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="lime" disabled={!ready} onClick={() => setConfirm("grant")}>
                {acc.live ? "Save changes" : "Grant Unlimited AI Access"}
              </Button>
              {acc.live && (
                <Button type="button" variant="danger" onClick={() => setConfirm("revoke")}>
                  Revoke
                </Button>
              )}
            </div>
          </fieldset>
        </Card>
      ) : (
        <p className="text-[13px] text-muted-foreground">Only super admins and finance can grant or revoke Unlimited AI Access.</p>
      )}

      <Card className="p-4 sm:p-5">
        <CardTitle hint="Every Unlimited AI Access change for this person.">
          <span className="inline-flex items-center gap-2"><History className="h-4 w-4" aria-hidden /> History</span>
        </CardTitle>
        {acc.grants.length > 0 && (
          <ul className="mb-3 grid gap-2 text-[13px]">
            {acc.grants.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-2">
                <Pill tone={GRANT_TONE[g.state]}>{g.state}</Pill>
                <span className="min-w-0">{featuresText(g.features)}</span>
                <span className="text-muted-foreground">{g.expiresAt ? `to ${fmtDate(g.expiresAt)}` : "permanent"}, by {g.grantedBy}</span>
              </li>
            ))}
          </ul>
        )}
        {acc.history.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nothing yet.</p>
        ) : (
          <ol className="grid gap-2 text-[13px]">
            {acc.history.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-2">
                <span className="w-28 shrink-0 text-muted-foreground">{fmtDate(h.createdAt, true)}</span>
                <span className="font-medium">{ACTION_LABEL[h.action] ?? h.action}</span>
                <span className="text-muted-foreground">by {h.actor}{h.actorRole ? ` (${h.actorRole})` : ""}</span>
                {h.note && <span className="text-muted-foreground">: {h.note}</span>}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <ConfirmDialog
        open={confirm === "grant"}
        onOpenChange={(o) => !o && setConfirm(null)}
        tone="primary"
        title={acc.live ? `Change Unlimited AI Access for ${acc.user.email}?` : `Give ${acc.user.email} Unlimited AI Access?`}
        body={`${featuresText(features)}, ${durationText}. No AI limits or upgrade prompts for these features. Rate limits, file size limits and abuse checks still apply.`}
        confirmLabel={acc.live ? "Save changes" : "Grant access"}
        cancelLabel="Cancel"
        busy={busy === "grant"}
        onConfirm={() => void grant()}
      />
      <ConfirmDialog
        open={confirm === "revoke"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Revoke Unlimited AI Access for ${acc.user.email}?`}
        body="Their plan's AI limits apply again from their next request. Usage so far stays counted."
        confirmLabel="Revoke access"
        busy={busy === "revoke"}
        extra={
          <div className="mt-3">
            <Label htmlFor={`ai-revoke-${userId}`}>Reason (kept in the audit log)</Label>
            <Input id={`ai-revoke-${userId}`} value={revokeNote} maxLength={300} onChange={(e) => setRevokeNote(e.target.value)} />
          </div>
        }
        onConfirm={() => void revoke()}
      />
    </div>
  );
}

/** "Manage AI" trigger for a table row: opens the panel in the shared Sheet, loading only when opened. */
export function AiAccessButton({ userId, name, canManage, label = "Manage AI" }: { userId: string; name: string; canManage: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => setOpen(true)} aria-label={`${label} for ${name}`}>
        <Sparkles className="h-4 w-4" aria-hidden /> {label}
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title="AI usage and access" description={name}>
        {open && <AiAccessPanel userId={userId} canManage={canManage} />}
      </Sheet>
    </>
  );
}
