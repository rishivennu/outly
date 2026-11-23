import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Empty, Hint, Pill, Table, type Tone } from "@/components/admin/ui";
import { AdminKpi } from "@/components/admin/motion/AdminKpi";
import { ScrollX } from "@/components/ui/scroll-x";
import type { CohortRow, RetentionRow } from "@/lib/admin/activation";
import type { Breakdown, Kpi, UserStatus } from "@/lib/admin/app-analytics";

/** R1308: small presentational pieces shared by the App Analytics page and the per-user page. Server-safe (no hooks). */

export const n = (v: number) => v.toLocaleString("en-IN");
export const pct = (r: number | null | undefined) => (r === null || r === undefined ? "" : `${Math.round(r * 100)}%`);
export const fmtDur = (s: number) => (s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`);

export function KpiGrid({ kpis, compare }: { kpis: Kpi[]; compare: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 [&>*]:min-w-0" role="list" aria-label="Key numbers">
      {kpis.map((k, i) => (
        <div key={k.key} role="listitem" className="min-w-0">
          <AdminKpi label={k.label} value={n(k.value)} change={k.change} spark={k.spark.length > 1 ? k.spark : undefined} i={i} compare={compare} hint={k.hint} unavailable={k.unavailable} compareNote={k.prev === null && !k.unavailable ? (k.key === "online" ? "Right now, no comparison" : "Nothing earlier to compare against") : undefined} />
        </div>
      ))}
    </div>
  );
}

export function BreakdownCard({ title, hint, rows, noun = "Value", empty }: { title: string; hint: string; rows: Breakdown; noun?: string; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.users));
  return (
    <Card as="div" className="min-w-0">
      <CardTitle hint={hint}>{title}</CardTitle>
      {rows.length === 0 ? (
        <Empty title="Nothing yet" body={empty} />
      ) : (
        <ol className="flex flex-col gap-2" aria-label={title}>
          {rows.map((r) => (
            <li key={r.key} className="text-[13px]">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{r.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  <b className="text-foreground">{n(r.users)}</b> {r.users === 1 ? "person" : "people"} · {pct(r.share)} of events
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-foreground/[0.06]" aria-hidden>
                <span className="block h-full rounded-full bg-[hsl(var(--lime))]" style={{ width: `${Math.max(2, (r.users / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
      <span className="sr-only">{noun}</span>
    </Card>
  );
}

export function RetentionCards({ rows }: { rows: RetentionRow[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
      {rows.map((r) => (
        <Card key={r.key} as="div" className="p-5">
          <p className="flex items-start gap-1 text-[12.5px] font-medium text-muted-foreground">
            <span>{r.label}</span>
            <Hint text={r.rule} label={`How ${r.label} retention is counted`} />
          </p>
          <p className={cn("mt-2 font-display font-bold leading-none tabular-nums", r.eligible ? "text-[1.75rem]" : "text-[1.1rem] text-muted-foreground")}>{r.eligible ? pct(r.rate) : "Not yet"}</p>
          <p className="mt-2.5 text-[12.5px] text-muted-foreground">
            {r.eligible ? `${n(r.retained)} of ${n(r.eligible)} came back` : "No one has finished this window yet"}
            {r.pending > 0 && <span className="block">{n(r.pending)} still inside the window</span>}
          </p>
        </Card>
      ))}
    </div>
  );
}

export function CohortGrid({ cohorts }: { cohorts: CohortRow[] }) {
  const weeks = cohorts[0]?.weeks.length ?? 8;
  return (
    <Card as="div" className="min-w-0">
      <CardTitle hint="Share of each weekly sign-up group active at least once in each later calendar week (Monday to Sunday, UTC). W0 is the week they joined. Hover a cell for the count.">Weekly cohorts</CardTitle>
      <ScrollX label="Weekly cohorts" className="pin-first -mx-5 px-5 sm:-mx-6 sm:px-6">
        <table className="w-full min-w-[620px] border-separate border-spacing-1 text-[12.5px]">
          <caption className="sr-only">Weekly cohort retention. Empty cells are weeks that have not started yet.</caption>
          <thead>
            <tr>
              <th scope="col" className="pb-1 pr-2 text-left font-semibold text-muted-foreground">Joined week of</th>
              <th scope="col" className="pb-1 pr-2 text-right font-semibold text-muted-foreground">People</th>
              {Array.from({ length: weeks }, (_, w) => (
                <th key={w} scope="col" className="pb-1 text-center font-semibold text-muted-foreground"><abbr title={w === 0 ? "Week they joined" : `Week ${w} after joining`} className="no-underline">W{w}</abbr></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((c) => (
              <tr key={c.start}>
                <th scope="row" className="pr-2 text-left font-medium">{c.label}</th>
                <td className="pr-2 text-right tabular-nums text-muted-foreground">{c.size}</td>
                {c.size === 0 ? (
                  <td colSpan={weeks} className="h-8 rounded-lg pl-2 text-left text-muted-foreground">No sign-ups this week</td>
                ) : (
                  c.weeks.map((r, w) => (
                    <td key={w} title={r === null ? "Not yet measurable" : `${c.active[w]} of ${c.size} active${c.partial === w ? ", week still running" : ""}`} className={cn("h-8 min-w-[56px] rounded-lg text-center tabular-nums", r === null ? "text-[11.5px] text-muted-foreground" : r >= 0.5 ? "font-semibold text-[hsl(var(--lime-foreground))]" : "text-foreground")} style={r === null ? undefined : { background: `hsl(var(--lime) / ${(0.06 + r * 0.84).toFixed(2)})` }}>
                      {r === null ? "Not yet" : <>{pct(r)}{c.partial === w && <span aria-label=", so far">*</span>}</>}
                    </td>
                  ))
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>
      <p className="mt-2 text-[12px] text-muted-foreground">* The week is still running, so the share can still grow. &quot;Not yet&quot; means the week has not started, which is not the same as 0%.</p>
    </Card>
  );
}

const STATUS: Record<UserStatus, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "ok" },
  new: { label: "New", tone: "lime" },
  quiet: { label: "Quiet", tone: "muted" },
  dormant: { label: "Dormant", tone: "warn" },
  never: { label: "Never active", tone: "muted" },
};
export const StatusPill = ({ status }: { status: UserStatus }) => <Pill tone={STATUS[status].tone}>{STATUS[status].label}</Pill>;

export function ExportLinks({ base, kinds }: { base: string; kinds: { kind: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]" role="group" aria-label="Export CSV">
      <span className="text-muted-foreground">CSV:</span>
      {kinds.map((k) => (
        <Link key={k.kind} href={`${base}${base.includes("?") ? "&" : "?"}export=${k.kind}`} className="inline-flex h-9 items-center rounded-full bg-secondary/60 px-3 font-medium text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))] [@media(hover:hover)]:hover:text-foreground touch:h-11" download>
          {k.label}
        </Link>
      ))}
    </div>
  );
}

export { Table };
