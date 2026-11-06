import * as React from "react";
import { cn } from "@/lib/utils";
import { ScrollX } from "@/components/ui/scroll-x";

/** Server-safe building blocks for admin pages. */
export function PageHead({ eyebrow, greet, title, body, actions }: { eyebrow?: string; greet?: React.ReactNode; title: string; body?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {greet && <div className="mb-3">{greet}</div>}
        {eyebrow && <p className="eyebrow mb-2 text-[11px]">{eyebrow}</p>}
        <h1 className="font-display text-[clamp(1.6rem,3vw,2.2rem)] font-bold leading-tight tracking-[-0.03em]">{title}</h1>
        {body && <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-muted-foreground">{body}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ className, children, as: As = "section", ...p }: { className?: string; children: React.ReactNode; as?: "section" | "div" | "article" } & React.HTMLAttributes<HTMLElement>) {
  return (
    <As className={cn("admin-card rounded-[24px] bg-card p-5 hairline sm:p-6", className)} {...p}>
      {children}
    </As>
  );
}

export function CardTitle({ children, hint, action }: { children: React.ReactNode; hint?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="font-display text-[1.05rem] font-semibold tracking-tight">{children}</h2>
        {hint && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

const TONES = {
  lime: "bg-lime/15 text-lime-ink",
  ok: "bg-success/15 pill-ink-ok",
  warn: "bg-warning/15 pill-ink-warn",
  bad: "bg-destructive/15 pill-ink-bad",
  info: "bg-accent/15 pill-ink-info",
  muted: "bg-secondary text-muted-foreground",
} as const;
export type Tone = keyof typeof TONES;

export function Pill({ tone = "muted", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[11.5px] font-semibold", TONES[tone], className)}>{children}</span>;
}

export const STATUS_TONE: Record<string, Tone> = {
  succeeded: "ok", active: "ok", sent: "ok", resolved: "ok",
  pending: "warn", past_due: "warn", mocked: "info", open: "lime",
  failed: "bad", canceled: "muted", refunded: "muted", urgent: "bad", high: "warn", normal: "muted",
};

export function Empty({ title, body, children }: { title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[20px] border border-dashed border-border px-6 py-12 text-center">
      <p className="font-display text-[1.05rem] font-semibold">{title}</p>
      {body && <p className="max-w-sm text-[13.5px] text-muted-foreground">{body}</p>}
      {children}
    </div>
  );
}

/** Plain text of a header cell, for the label each value carries in the phone card layout. */
function headText(h: React.ReactNode): string {
  if (h === null || h === undefined || typeof h === "boolean") return "";
  if (typeof h === "string" || typeof h === "number") return String(h);
  if (Array.isArray(h)) return h.map(headText).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(h)) return headText(h.props.children);
  return "";
}
/**
 * What a column holds on the phone card: an sr-only header (e.g. "Action") or an empty one is a column of buttons;
 * a header that is itself a control with no text (a select-all checkbox) is a row picker, pinned to the card's corner.
 */
function headKind(h: React.ReactNode): "action" | "select" | "field" {
  if (typeof h === "string") return h.trim() === "" ? "action" : "field";
  if (!React.isValidElement<{ className?: string }>(h)) return "field";
  if (/\bsr-only\b/.test(h.props.className ?? "")) return "action";
  return headText(h).trim() === "" ? "select" : "field";
}

type TableProps = {
  head: React.ReactNode[];
  children: React.ReactNode;
  className?: string;
  label?: string;
  /**
   * How the table behaves below 640px. "cards" (default): every row becomes a stacked card, the lead column as its
   * title and every other cell under its own header label, so nothing hides off to the right. "scroll": the table
   * stays a grid (for matrices that only make sense side by side) inside its own scroller, with the first column pinned.
   */
  mobile?: "cards" | "scroll";
  /** Which column names the row (the card's title on phones). Defaults to the first. */
  lead?: number;
  /** Narrowest the table may get on wide screens before it scrolls inside its card. */
  minWidth?: number;
};

/**
 * The admin data table. From 640px up it is a normal table that scrolls inside its card if the card is narrower
 * than it (never the page). On phones it turns into labelled cards (or a pinned-column scroller, see `mobile`).
 * Labels are read from `head`, so every page gets the phone layout without changing how it writes its rows.
 */
export function Table({ head, children, className, label = "Table", mobile = "cards", lead = 0, minWidth = 640 }: TableProps) {
  const labels = head.map(headText);
  const kinds = head.map(headKind);
  const rows = React.Children.map(children, (row) => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(row) || row.type !== "tr") return row;
    let col = 0;
    const cells = React.Children.map(row.props.children, (cell) => {
      if (!React.isValidElement<{ colSpan?: number; "data-label"?: string }>(cell) || (cell.type !== "td" && cell.type !== "th")) return cell;
      const i = col;
      col += Math.max(1, Number(cell.props.colSpan) || 1);
      const kind = Number(cell.props.colSpan) > 1 ? "full" : i === lead ? "lead" : (kinds[i] ?? "field");
      // Explicit roles keep the table semantics when the phone layout turns rows into grid cards.
      return React.cloneElement(cell as React.ReactElement<Record<string, unknown>>, {
        role: cell.type === "th" ? "rowheader" : "cell",
        "data-cell": kind,
        "data-label": kind === "field" ? (cell.props["data-label"] ?? labels[i] ?? undefined) : undefined,
      });
    });
    return React.cloneElement(row as React.ReactElement<Record<string, unknown>>, { role: "row" }, cells);
  });
  return (
    <ScrollX label={label} className={cn("atable -mx-5 px-5 sm:-mx-6 sm:px-6", mobile === "cards" ? "atable--cards" : "atable--scroll pin-first", className)}>
      <table role="table" className="w-full border-separate border-spacing-0 text-[13.5px]" style={{ minWidth }}>
        <thead role="rowgroup">
          <tr role="row">
            {head.map((h, i) => (
              <th key={i} scope="col" role="columnheader" data-kind={kinds[i]} className="border-b border-border pb-2.5 pr-4 text-left text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground last:pr-0">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup" className="[&_td]:border-b [&_td]:border-border/60 [&_td]:py-3 [&_td]:pr-4 [&_td:last-child]:pr-0 [&_tr:last-child_td]:border-0 [&_tr]:transition-colors [&_tr:hover]:bg-foreground/[0.02]">
          {rows}
        </tbody>
      </table>
    </ScrollX>
  );
}

export const fmtDate = (d: Date | string | null | undefined, withTime = false) =>
  d
    ? new Date(d).toLocaleString("en-IN", withTime ? { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" } : { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })
    : "Never";

export function ago(d: Date | string | null | undefined) {
  if (!d) return "Never";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(d);
}
