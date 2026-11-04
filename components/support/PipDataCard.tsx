"use client";
import { useId, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, CheckCircle2, CircleDashed, Database, Download, ExternalLink, FileArchive, Info, Search } from "lucide-react";
import type { PipChart, PipLink, PipResult } from "@/lib/pip/types";
import { cn } from "@/lib/utils";

/** recharts only loads when a card actually has a chart (1123). */
const ChartView = dynamic(() => import("./PipChartView"), { ssr: false, loading: () => <div className="pd-chart-wait h-[168px]" aria-hidden /> });

/** A chart plus its numbers as a table, for screen readers and anyone who wants the exact values. */
function ChartBlock({ c }: { c: PipChart }) {
  const id = useId();
  return (
    <figure className="pd-chart mt-2" aria-labelledby={`${id}-c`}>
      <figcaption id={`${id}-c`} className="mb-1 flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold">
        {c.title}
        {c.series.some((s) => s.estimate) && <span className="pd-badge pd-est">Includes an estimate</span>}
      </figcaption>
      <ChartView c={c} />
      <details className="pd-details mt-1">
        <summary className="pc-muted text-[12px]">Show the numbers</summary>
        <div className="pd-scroll mt-1" tabIndex={0} role="region" aria-label={`${c.title}, numbers`}>
          <table className="pd-table">
            <thead>
              <tr>
                <th scope="col">{c.kind === "bar" ? "Group" : "Date"}</th>
                {c.series.map((s) => <th key={s.key} scope="col" className="text-end">{s.estimate ? `${s.label} (estimate)` : s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {c.x.map((x, i) => (
                <tr key={`${x}-${i}`}>
                  <td>{x}</td>
                  {c.series.map((s) => <td key={s.key} className="text-end tabular-nums">{s.values[i] == null ? "No data" : `${s.values[i]!.toLocaleString()}${c.unit ? ` ${c.unit}` : ""}`}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/**
 * The records card under a Pip answer (1049). Says exactly what was searched (period + timezone), how many
 * matched vs how many are shown, and whether the list is complete, before any row. Downloads are short-lived
 * links that only work in this person's own session.
 */
const FIRST = 8;

function LinkBtn({ l, compact }: { l: PipLink; compact?: boolean }) {
  const external = /^https?:\/\//.test(l.href);
  const Icon = l.download ? (/ZIP/.test(l.label) ? FileArchive : Download) : ExternalLink;
  return (
    <a
      href={l.href}
      {...(l.download ? { download: "" } : {})}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      aria-label={compact ? l.label : undefined}
      title={compact ? l.label : undefined}
      className={cn(compact ? "pc-icon pc-icon-sm" : "pc-btn", "pd-link")}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {!compact && <span>{l.label}</span>}
    </a>
  );
}

export function PipDataCard({ r }: { r: PipResult }) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const id = useId();
  const hasLinks = r.rows.some((x) => x.links?.length);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? r.rows.filter((x) => Object.values(x.cells).some((v) => String(v ?? "").toLowerCase().includes(t))) : r.rows;
  }, [q, r.rows]);
  const shown = all || q ? rows : rows.slice(0, FIRST);

  return (
    <section aria-labelledby={`${id}-t`} className="pc-card pd mt-2 max-w-full p-3 text-[14px]">
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h3 id={`${id}-t`} className="text-[15px] font-semibold leading-snug">{r.title}</h3>
          <p className="pc-muted text-[12.5px]">
            {r.range ? `${r.range.label}, ${r.range.tz.replace(/_/g, " ")} time` : "Everything on record"}
          </p>
        </div>
        {r.estimate && <span className="pd-badge pd-est" title="Contains projections, not actuals">Estimate</span>}
        <span className={cn("pd-badge", r.complete ? "pd-ok" : "pd-warn")}>
          {r.complete ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <CircleDashed className="h-3.5 w-3.5" aria-hidden />}
          {r.complete ? "Complete" : "Incomplete"}
        </span>
      </header>

      {!!r.cards?.length && (
        <ul className="pd-cards mt-2" aria-label="Key numbers">
          {r.cards.map((c) => (
            <li key={c.label} className={cn("pd-kpi", c.kind === "estimate" && "pd-kpi-est")}>
              <span className="pc-muted flex items-center gap-1 text-[11.5px]">
                {c.label}
                {c.kind === "estimate" && <span className="pd-badge pd-est pd-badge-xs">Estimate</span>}
              </span>
              <span className="text-[17px] font-semibold leading-tight tabular-nums">{c.value}</span>
              {c.delta && <span className={cn("text-[11.5px] tabular-nums", /^[-\u2212]/.test(c.delta) ? "pd-note-warn" : /^\+/.test(c.delta) ? "pd-ok" : "pc-muted")}>{c.delta}</span>}
              {c.hint && <span className="pc-muted text-[11px] leading-snug">{c.hint}</span>}
            </li>
          ))}
        </ul>
      )}

      {r.charts?.map((c) => <ChartBlock key={c.id} c={c} />)}

      {(r.rows.length > 0 || r.found > 0) && !r.cards?.length && (
        <p className="mt-1.5 text-[13px]">
          Found <strong>{r.found}</strong>
          {r.returned !== r.found ? <> · showing <strong>{r.returned}</strong></> : null}
        </p>
      )}

      {r.totals.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Totals">
          {r.totals.map((t) => (
            <li key={t.label} className="pd-total">
              <span className="pc-muted text-[11.5px]">{t.label}</span>
              <span className="font-semibold tabular-nums">{t.value}</span>
            </li>
          ))}
        </ul>
      )}

      {r.notes.length > 0 && (
        <ul className="mt-2 space-y-1">
          {r.notes.map((n, i) => (
            <li key={i} className={cn("flex gap-1.5 text-[12.5px] leading-snug", n.level === "warn" ? "pd-note-warn" : "pc-muted")}>
              {n.level === "warn" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
              <span>{n.text}</span>
            </li>
          ))}
        </ul>
      )}

      {r.rows.length === 0 ? (
        <p className="pc-muted mt-2 text-[13px]">{r.empty}</p>
      ) : (
        <>
          {r.rows.length > FIRST && (
            <label className="pd-search mt-2">
              <Search className="pc-muted h-4 w-4 shrink-0" aria-hidden />
              <span className="sr-only">Filter these {r.rows.length} rows</span>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" className="min-w-0 flex-1 bg-transparent text-[14px]" />
            </label>
          )}
          <div className="pd-scroll mt-2" tabIndex={0} role="region" aria-label={`${r.title}, table`}>
            <table className="pd-table">
              <caption className="sr-only">
                {r.title}. {q ? `${rows.length} match the filter.` : `Showing ${shown.length} of ${r.rows.length}.`}
              </caption>
              <thead>
                <tr>
                  {r.columns.map((c) => (
                    <th key={c.key} scope="col" className={cn(c.align === "end" && "text-end")}>{c.label}</th>
                  ))}
                  {hasLinks && <th scope="col"><span className="sr-only">Files and links</span></th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id}>
                    {r.columns.map((c) => (
                      <td key={c.key} className={cn(c.align === "end" && "text-end tabular-nums", c.mono && "font-mono text-[12.5px]")}>{row.cells[c.key] ?? ""}</td>
                    ))}
                    {hasLinks && (
                      <td className="whitespace-nowrap">
                        {row.links?.map((l) => <LinkBtn key={l.href} l={l} compact />)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {q && rows.length === 0 && <p className="pc-muted mt-1.5 text-[13px]">Nothing matches &ldquo;{q}&rdquo;.</p>}
          {!q && rows.length > FIRST && (
            <button type="button" onClick={() => setAll((v) => !v)} className="pc-btn mt-2" aria-expanded={all}>
              {all ? `Show the first ${FIRST}` : `Show all ${rows.length}`}
            </button>
          )}
        </>
      )}

      {r.downloads.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {r.downloads.map((l) => <LinkBtn key={l.href} l={l} />)}
        </div>
      )}
      {r.downloads.some((l) => l.download) && <p className="pc-muted mt-1.5 text-[12px]">Download links work for 10 minutes, only while you&apos;re signed in.</p>}
      {!!r.sources?.length && (
        <p className="pc-muted mt-2 flex gap-1.5 text-[11.5px] leading-snug">
          <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>Source: {r.sources.join(" · ")}</span>
        </p>
      )}
    </section>
  );
}
