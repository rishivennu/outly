import Link from "next/link";
import { AlertTriangle, HardDrive, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtBytes, fmtDay, type MonthlyFigures, type StorageFiguresR1209, type UsageState } from "@/lib/storage/quota-core";

/** R1209: what GET /api/storage/usage answers (lib/storage/quota.ts StorageUsage), as the browser receives it. */
export type QuotaView = {
  policy: "monthly" | "storage" | "both";
  monthly: MonthlyFigures | null;
  storage: StorageFiguresR1209 | null;
  storedBytes: number;
  maxFileBytes: number;
  state: UsageState;
  canUpload: boolean;
  message: string | null;
  planName: string;
  planSlug: string;
  upgradeUrl: string;
};

const BAR: Record<UsageState, string> = { normal: "bg-lime", warning: "bg-warning", critical: "bg-destructive", full: "bg-destructive" };
const STATE_LABEL: Record<UsageState, string> = { normal: "Plenty of room", warning: "Getting full", critical: "Almost full", full: "Full" };

function stateOf(pct: number, room: number): UsageState {
  if (room < 1) return "full";
  return pct >= 95 ? "critical" : pct >= 80 ? "warning" : "normal";
}

function Bar({ id, pct, state, text }: { id: string; pct: number; state: UsageState; text: string }) {
  return (
    <div role="progressbar" aria-labelledby={id} aria-valuetext={text} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="mt-2.5 h-2 overflow-hidden rounded-full bg-secondary">
      <div className={cn("h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none", BAR[state])} style={{ width: `${Math.max(pct > 0 ? 2 : 0, Math.min(100, pct))}%` }} />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="text-[14px] font-semibold tabular">{value}</dd>
    </div>
  );
}

function StatePill({ state }: { state: UsageState }) {
  return (
    <span data-state={state} className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold", state === "normal" ? "bg-secondary text-foreground" : state === "warning" ? "bg-warning/20 text-foreground" : "bg-destructive/15 text-[hsl(0_72%_38%)] dark:text-destructive")}>
      {state !== "normal" && <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
      {STATE_LABEL[state]}
    </span>
  );
}

/**
 * Billing: Free reads "Monthly upload allowance" (what was uploaded this cycle, never given back by a delete);
 * paid reads "Storage" (what is kept right now). The allowance is never shown as retained storage.
 */
export function QuotaCard({ q, onUpgrade, manageHref = "/settings#storage", className }: { q: QuotaView; onUpgrade?: () => void; manageHref?: string; className?: string }) {
  const m = q.monthly && !q.monthly.unlimited ? q.monthly : null;
  const s = q.storage && !q.storage.unlimited ? q.storage : null;
  const tight = q.state !== "normal";
  return (
    <div className={cn("mt-4 grid gap-3", m && s && "lg:grid-cols-2", className)}>
      {m && (
        <section aria-labelledby="quota-monthly" className="min-w-0 rounded-[20px] bg-secondary/40 p-4 hairline">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="quota-monthly" className="flex items-center gap-2 text-[14px] font-semibold"><Upload className="h-4 w-4" aria-hidden /> Monthly upload allowance</h3>
            <StatePill state={stateOf(m.percent, m.remainingBytes)} />
          </div>
          <Bar id="quota-monthly" pct={m.percent} state={stateOf(m.percent, m.remainingBytes)} text={`${fmtBytes(m.usedBytes + m.reservedBytes)} of ${fmtBytes(m.allowanceBytes)} used this month`} />
          <dl className="mt-3 grid grid-cols-3 gap-3">
            <Fact label="Used this month" value={fmtBytes(m.usedBytes + m.reservedBytes)} />
            <Fact label="Remaining" value={fmtBytes(m.remainingBytes)} />
            <Fact label="Renews on" value={fmtDay(m.resetAt)} />
          </dl>
          <p className="mt-3 text-[12.5px] leading-snug text-muted-foreground">Every upload counts once this month. Deleting a file does not give the allowance back; it starts again on the renewal date.</p>
        </section>
      )}
      {s && (
        <section aria-labelledby="quota-storage" className="min-w-0 rounded-[20px] bg-secondary/40 p-4 hairline">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="quota-storage" className="flex items-center gap-2 text-[14px] font-semibold"><HardDrive className="h-4 w-4" aria-hidden /> Storage</h3>
            <StatePill state={stateOf(s.percent, s.availableBytes)} />
          </div>
          <Bar id="quota-storage" pct={s.percent} state={stateOf(s.percent, s.availableBytes)} text={`${fmtBytes(s.usedBytes)} used of ${fmtBytes(s.capacityBytes)}`} />
          <dl className="mt-3 grid grid-cols-3 gap-3">
            <Fact label="Used" value={`${fmtBytes(s.usedBytes)} of ${fmtBytes(s.capacityBytes)}`} />
            <Fact label="Available" value={fmtBytes(s.availableBytes)} />
            <Fact label="Full" value={`${s.percent}%`} />
          </dl>
          <p className="mt-3 text-[12.5px] leading-snug text-muted-foreground">
            Files you keep count here{s.trashBytes > 0 ? `, including ${fmtBytes(s.trashBytes)} in Trash until it is emptied` : ""}. Deleting a file for good frees its space.
          </p>
        </section>
      )}
      {!m && !s && (
        <p className="rounded-[20px] bg-secondary/40 p-4 text-[13px] hairline">
          {fmtBytes(q.storedBytes)} stored. {q.planName} has no upload or storage cap.
        </p>
      )}
      {(tight || s) && (
        <div className={cn("flex flex-wrap items-center gap-3", m && s && "lg:col-span-2")}>
          {q.message && <p role={q.state === "full" ? "alert" : undefined} className="min-w-0 flex-1 basis-64 text-[13px] leading-snug">{q.message}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {s && (
              <Button asChild size="sm" variant="outline" className="min-h-11">
                <Link href={manageHref}>Manage storage</Link>
              </Button>
            )}
            {tight && onUpgrade && (
              <Button type="button" size="sm" className="min-h-11" onClick={onUpgrade}>Upgrade</Button>
            )}
            {tight && !onUpgrade && (
              <Button asChild size="sm" className="min-h-11">
                <Link href={q.upgradeUrl}>Upgrade</Link>
              </Button>
            )}
          </div>
        </div>
      )}
      {m && !tight && !s && (
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline" className="min-h-11">
            <Link href={manageHref}>See your files</Link>
          </Button>
          {onUpgrade && <Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={onUpgrade}>Upgrade for more</Button>}
        </div>
      )}
    </div>
  );
}
