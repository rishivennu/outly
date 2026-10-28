"use client";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { cn, compact } from "@/lib/utils";
import type { AnalyticsSummary } from "@/lib/analytics";

type Acct = AnalyticsSummary["byAccount"][number];

/** Download the numbers on screen as a client-ready PDF or CSV (same range and account). */
export function ReportButtons({ days, account }: { days: number; account: string | null }) {
  const q = `days=${days}${account ? `&account=${encodeURIComponent(account)}` : ""}`;
  const cls = "inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium hairline hover:bg-secondary/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  return (
    <div className="flex shrink-0 gap-2" role="group" aria-label="Download report">
      <a href={`/api/reports?format=pdf&${q}`} download className={cls}>
        <FileDown className="h-4 w-4" aria-hidden="true" /> PDF report
      </a>
      <a href={`/api/reports?format=csv&${q}`} download className={cls}>
        <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> CSV
      </a>
    </div>
  );
}

/**
 * Combined view first, then each account's share of it. Picking an account reloads the page's numbers for
 * just that profile; "All accounts" goes back. Only shown when there is more than one account to compare.
 */
export function AccountDrill({ accounts, active, onPick, busy }: { accounts: Acct[]; active: string | null; onPick: (id: string | null) => void; busy: boolean }) {
  if (accounts.length < 2) return null;
  const max = Math.max(...accounts.map((a) => a.views), 1);
  return (
    <section aria-labelledby="by-account" className="glass mt-3 rounded-[28px] p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="by-account" className="text-lg font-semibold">By account</h2>
        <p className="text-sm text-muted-foreground">Pick one to see only its numbers.</p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <li>
          <button type="button" aria-pressed={active === null} disabled={busy} onClick={() => onPick(null)} className={cn("flex min-h-[64px] w-full items-center gap-3 rounded-[18px] px-4 py-3 text-left hairline transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", active === null ? "bg-[hsl(var(--lime)/0.18)] ring-2 ring-[hsl(var(--lime))]" : "hover:bg-secondary/70")}>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary text-sm font-semibold" aria-hidden="true">{accounts.length}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">All accounts</span>
              <span className="block text-sm text-muted-foreground">Combined</span>
            </span>
          </button>
        </li>
        {accounts.map((a) => (
          <li key={a.accountId}>
            <button type="button" aria-pressed={active === a.accountId} disabled={busy} onClick={() => onPick(a.accountId)} className={cn("flex min-h-[64px] w-full items-center gap-3 rounded-[18px] px-4 py-3 text-left hairline transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", active === a.accountId ? "bg-[hsl(var(--lime)/0.18)] ring-2 ring-[hsl(var(--lime))]" : "hover:bg-secondary/70")}>
              <span className="relative shrink-0">
                {a.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.avatar} alt="" className="h-10 w-10 rounded-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-secondary text-sm font-semibold" aria-hidden="true">{a.username.replace(/^@/, "").slice(0, 1).toUpperCase()}</span>
                )}
                <span className="absolute -bottom-1 -right-1"><PlatformOrb platform={a.platform as Platform} size={18} /></span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{a.username}<span className="sr-only"> on {PLATFORM_META[a.platform as Platform]?.name ?? a.platform}</span></span>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
                  <span className="block h-full rounded-full lime-bg" style={{ width: `${(a.views / max) * 100}%` }} />
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="tabular block font-semibold">{compact(a.views)}<span className="sr-only"> views</span></span>
                <span className="tabular block text-sm text-muted-foreground">{a.engagement.toFixed(1)}%<span className="sr-only"> engaged</span></span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
