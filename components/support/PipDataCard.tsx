"use client";
import { useId, useRef, useState } from "react";
import { AlertTriangle, CircleDashed, Database, Download, ExternalLink, FileArchive, Loader2, RefreshCw } from "lucide-react";
import { ANALYTIC_TOOLS, type PipLink, type PipResult, type PipRow } from "@/lib/pip/types";
import { cn } from "@/lib/utils";

/**
 * The small footer under a Pip answer. USER RULE (1125): no graphs, no number cards, no tables; the answer text
 * carries the numbers. This only says what was looked at (period + timezone), where it came from, any warning,
 * and for a list question ("my invoices", "posts from August") the top few items as plain lines with their links.
 * Downloads are short-lived links that only work in this person's own session.
 */
const TOP = 5;

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

/** One plain line per item: its first column, then at most two more values, each with its label. */
function lineOf(r: PipResult, row: PipRow) {
  const [main, ...rest] = r.columns;
  const more = rest
    .map((c) => {
      const v = row.cells[c.key];
      return v == null || v === "" ? null : c.label ? `${c.label}: ${v}` : String(v);
    })
    .filter((x): x is string => !!x)
    .slice(0, 2);
  return { main: main ? String(row.cells[main.key] ?? "") : "", more: more.join(" · ") };
}

/** "14 Nov, 10:42 am" in the person's timezone (the card's own), for the sync badge. */
function whenOf(iso: string, tz?: string) {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
  try {
    return new Date(iso).toLocaleString("en-IN", { ...opts, ...(tz ? { timeZone: tz } : {}) });
  } catch {
    return new Date(iso).toLocaleString("en-IN", opts);
  }
}

type RefreshItem = { accountId: string; platform: string; username: string; ok: boolean; code: string; message: string; lastSuccessAt: string | null };
type RefreshState = { busy: boolean; ok: boolean | null; message: string; items: RefreshItem[] };

/**
 * 1151: Refresh data. Reads every connected account from its platform now. Success is only shown when fresh
 * numbers really came back (the server's `ok`); otherwise its own words, per account, and a Try again.
 */
function RefreshData({ onRefreshed }: { onRefreshed?: () => void }) {
  const [s, setS] = useState<RefreshState>({ busy: false, ok: null, message: "", items: [] });
  const busyRef = useRef(false);
  async function go() {
    if (busyRef.current) return;
    busyRef.current = true;
    setS({ busy: true, ok: null, message: "", items: [] });
    try {
      const res = await fetch("/api/pip/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const j = await res.json().catch(() => ({}));
      const items: RefreshItem[] = Array.isArray(j.items) ? j.items : [];
      const message = typeof j.message === "string" && j.message ? j.message : typeof j.error === "string" ? j.error : "Refresh didn't finish. Nothing was changed.";
      const ok = res.ok && j.ok === true;
      setS({ busy: false, ok, message, items });
      if (ok) onRefreshed?.();
    } catch {
      setS({ busy: false, ok: false, message: navigator.onLine ? "Refresh didn't finish. Nothing was changed." : "You're offline, so nothing could be refreshed.", items: [] });
    } finally {
      busyRef.current = false;
    }
  }
  const failed = s.items.filter((x) => !x.ok);
  return (
    <div className="mt-2">
      <button type="button" onClick={go} disabled={s.busy} aria-busy={s.busy} className="pc-btn">
        {s.busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
        <span>{s.busy ? "Refreshing" : s.ok === false ? "Try again" : "Refresh data"}</span>
      </button>
      <div aria-live="polite">
        {s.ok === true && <p className="pc-muted mt-1.5 text-[12px]">{s.message}</p>}
        {s.ok === false && (
          <div role="alert" className="pd-note-warn mt-1.5 text-[13px] leading-snug">
            <p>{s.message}</p>
            {failed.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {failed.map((x) => <li key={x.accountId}>{x.message}</li>)}
              </ul>
            )}
          </div>
        )}
        {s.ok === true && failed.length > 0 && (
          <ul className="pd-note-warn mt-1 space-y-0.5 text-[13px] leading-snug">
            {failed.map((x) => <li key={x.accountId}>{x.message}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}

export function PipDataCard({ r, onRefreshed }: { r: PipResult; onRefreshed?: () => void }) {
  const id = useId();
  const numbers = ANALYTIC_TOOLS.includes(r.tool) || r.tool === "top_posts" || r.tool === "engagement";
  const list = ANALYTIC_TOOLS.includes(r.tool) ? [] : r.rows.slice(0, TOP);
  const warn = r.notes.filter((n) => n.level === "warn");
  const total = Math.max(r.found, r.rows.length);

  return (
    <section aria-labelledby={`${id}-t`} className="pc-card pd mt-2 max-w-full p-3 text-[13px]">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 id={`${id}-t`} className="text-[14px] font-semibold leading-snug">{r.title}</h3>
        <span className="flex flex-wrap gap-1.5">
          {r.estimate && <span className="pd-badge pd-est" title="Contains projections, not actuals">Estimate</span>}
          {r.sync && r.sync.at && (
            <span className={cn("pd-badge", r.sync.stale && "pd-warn")} title={r.sync.stale ? "Older than 30 minutes: these numbers come from the last successful sync" : "Synced within the last 30 minutes"}>
              {r.sync.stale ? `Cached · synced ${whenOf(r.sync.at, r.range?.tz)}` : `Live · synced ${whenOf(r.sync.at, r.range?.tz)}`}
            </span>
          )}
          {r.sync && !r.sync.at && r.sync.accounts.length > 0 && <span className="pd-badge pd-warn">Not synced yet</span>}
          {!r.complete && (
            <span className="pd-badge pd-warn">
              <CircleDashed className="h-3.5 w-3.5" aria-hidden />
              Incomplete
            </span>
          )}
        </span>
      </header>
      <p className="pc-muted text-[12px]">{r.range ? `${r.range.label}, ${r.range.tz.replace(/_/g, " ")} time` : "Everything on record"}</p>

      {list.length > 0 && (
        <ul className="mt-2" aria-label={r.title}>
          {list.map((row) => {
            const l = lineOf(r, row);
            return (
              <li key={row.id} className="pd-line flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block font-medium leading-snug">{l.main}</span>
                  {l.more && <span className="pc-muted block text-[12px] leading-snug tabular-nums">{l.more}</span>}
                </span>
                {row.links?.map((x) => <LinkBtn key={x.href} l={x} compact />)}
              </li>
            );
          })}
        </ul>
      )}
      {list.length > 0 && total > list.length && (
        <p className="pc-muted mt-1 text-[12px]">
          Top {list.length} of {total}.{r.downloads.some((x) => x.download) ? " Download the full list below." : ""}
        </p>
      )}

      {warn.length > 0 && (
        <ul className="mt-2 space-y-1">
          {warn.map((n, i) => (
            <li key={i} className="pd-note-warn flex gap-1.5 text-[13px] leading-snug">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{n.text}</span>
            </li>
          ))}
        </ul>
      )}

      {r.downloads.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {r.downloads.map((l) => <LinkBtn key={l.href} l={l} />)}
        </div>
      )}
      {numbers && r.sync && r.sync.accounts.length > 0 && <RefreshData onRefreshed={onRefreshed} />}
      {r.downloads.some((l) => l.download) && <p className="pc-muted mt-1.5 text-[12px]">Download links work for 10 minutes, only while you&apos;re signed in.</p>}
      {!!r.sources?.length && (
        <p className="pc-muted mt-2 flex gap-1.5 text-xs leading-snug">
          <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>Source: {r.sources.join(" · ")}</span>
        </p>
      )}
    </section>
  );
}
