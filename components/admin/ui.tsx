import * as React from "react";
import { AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollX } from "@/components/ui/scroll-x";

/** Server-safe building blocks for admin pages. */
export function PageHead({ eyebrow, greet, title, body, actions }: { eyebrow?: string; greet?: React.ReactNode; title: string; body?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {greet && <div className="mb-3">{greet}</div>}
        {eyebrow && <p className="eyebrow mb-2 text-[11px]">{eyebrow}</p>}
        <h1 className="font-display text-[clamp(1.45rem,2.6vw,1.9rem)] font-semibold leading-[1.18]">{title}</h1>
        {body && <p className="mt-1.5 max-w-xl text-[13.5px] leading-[1.6] text-muted-foreground">{body}</p>}
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

/**
 * 1163: one status vocabulary for the whole panel. A page passes the machine value it stores; the badge
 * shows the agreed label and tone, so "skipped" reads "Held back" on every screen and a platform's state uses
 * the same seven words everywhere. Unknown values fall back to the raw text in a neutral badge.
 */
export const STATUS_LABEL: Record<string, { label: string; tone: Tone }> = {
  // platform and integration configuration
  configured: { label: "Configured", tone: "info" },
  connected: { label: "Connected", tone: "ok" },
  live: { label: "Live", tone: "ok" },
  pending_approval: { label: "Pending approval", tone: "warn" },
  requires_reconnect: { label: "Requires reconnect", tone: "warn" },
  needs_reconnect: { label: "Requires reconnect", tone: "warn" },
  missing_credentials: { label: "Missing credentials", tone: "muted" },
  unsupported: { label: "Unsupported feature", tone: "muted" },
  config_error: { label: "Configuration error", tone: "bad" },
  // notification deliveries and queue
  sent: { label: "Accepted", tone: "ok" },
  skipped: { label: "Held back", tone: "muted" },
  queued: { label: "Waiting", tone: "info" },
  failed: { label: "Failed", tone: "bad" },
  pending: { label: "Waiting", tone: "warn" },
  done: { label: "Done", tone: "ok" },
  dead: { label: "Given up", tone: "bad" },
  // money, tickets, accounts
  succeeded: { label: "Succeeded", tone: "ok" },
  active: { label: "Active", tone: "ok" },
  resolved: { label: "Resolved", tone: "ok" },
  past_due: { label: "Past due", tone: "warn" },
  mocked: { label: "Practice", tone: "info" },
  open: { label: "Open", tone: "lime" },
  canceled: { label: "Cancelled", tone: "muted" },
  refunded: { label: "Refunded", tone: "muted" },
  urgent: { label: "Urgent", tone: "bad" },
  high: { label: "High", tone: "warn" },
  normal: { label: "Normal", tone: "muted" },
  paused: { label: "Paused", tone: "warn" },
  running: { label: "Running", tone: "ok" },
};

export function StatusBadge({ status, label, className }: { status: string; label?: React.ReactNode; className?: string }) {
  const s = STATUS_LABEL[status];
  return (
    <Pill tone={s?.tone ?? "muted"} className={className}>
      {label ?? s?.label ?? status}
    </Pill>
  );
}

/**
 * 1163: a plain CSS tooltip, usable from server components. Shown on hover (pointer devices) and on focus
 * within, so a keyboard user reaching the child sees it too. With `describe` the child is linked to the text
 * via aria-describedby; otherwise the tooltip is a visual duplicate of the child's own label and hidden from
 * assistive tech. CSS lives in globals.css under "1163: admin tooltip".
 */
export function Tooltip({ text, children, side = "top", describe = false, className }: { text: string; children: React.ReactElement<Record<string, unknown>>; side?: "top" | "right" | "bottom"; describe?: boolean; className?: string }) {
  const id = React.useId();
  const child = describe ? React.cloneElement(children, { "aria-describedby": id }) : children;
  return (
    <span className={cn("admin-tipwrap relative inline-flex", className)}>
      {child}
      <span id={id} role="tooltip" aria-hidden={describe ? undefined : true} data-side={side} className="admin-tip">
        {text}
      </span>
    </span>
  );
}

/** A small "i" that explains how a number is counted. The text is read to screen readers through the button's description. */
export function Hint({ text, label = "How this is counted" }: { text: string; label?: string }) {
  return (
    <Tooltip text={text} describe>
      <button type="button" aria-label={label} className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground [@media(hover:hover)]:hover:bg-secondary [@media(hover:hover)]:hover:text-foreground">
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
    </Tooltip>
  );
}

/**
 * 1163: a titled region of a page: heading, one line on what it holds, optional controls, then its cards in a
 * responsive grid. Pages compose Sections instead of hand-rolled headings, so spacing and type stay the same.
 */
export function Section({ title, hint, actions, cols = 1, className, children, id }: { title: string; hint?: React.ReactNode; actions?: React.ReactNode; cols?: 1 | 2 | 3 | 4; className?: string; children: React.ReactNode; id?: string }) {
  const grid = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 xl:grid-cols-3", 4: "grid-cols-2 lg:grid-cols-4" }[cols];
  return (
    <section aria-labelledby={id ? `${id}-title` : undefined} className={cn("mt-8 first:mt-0", className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 id={id ? `${id}-title` : undefined} className="font-display text-[1.05rem] font-semibold tracking-tight">{title}</h2>
          {hint && <p className="mt-0.5 text-[13px] text-muted-foreground">{hint}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={cn("grid gap-3", grid)}>{children}</div>
    </section>
  );
}

/** A card-shaped placeholder with the same radius and padding as the card it stands in for. */
export function LoadingState({ lines = 3, className, label = "Loading" }: { lines?: number; className?: string; label?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("admin-card rounded-[24px] bg-card p-5 hairline sm:p-6", className)}>
      <span className="sr-only">{label}</span>
      <div className="space-y-3" aria-hidden>
        <div className="skeleton h-4 w-32 rounded-lg" />
        <div className="skeleton h-8 w-40 rounded-xl" />
        {Array.from({ length: Math.max(0, lines - 2) }, (_, i) => (
          <div key={i} className="skeleton h-3.5 rounded-lg" style={{ width: `${88 - i * 14}%` }} />
        ))}
      </div>
    </div>
  );
}

/**
 * What a card shows when its data could not be loaded: the fact, the cause in plain words, and a way to retry.
 * Never a zero and never a guess (brief 9: no mock data on failure).
 */
export function ErrorState({ title = "Couldn't load this", body, retry, children, className }: { title?: string; body?: string; retry?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-2 rounded-[20px] bg-destructive/[0.06] px-5 py-5 hairline", className)}>
      <p className="flex items-center gap-2 font-display text-[1rem] font-semibold">
        <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden /> {title}
      </p>
      {body && <p className="max-w-prose text-[13.5px] leading-relaxed text-muted-foreground">{body}</p>}
      {(retry || children) && <div className="mt-1 flex flex-wrap items-center gap-2">{retry}{children}</div>}
    </div>
  );
}

/** "Not available" for a single value: the integration is off, the API did not answer, or the role cannot see it. */
export function Unavailable({ reason, className }: { reason: string; className?: string }) {
  return (
    <span className={cn("inline-flex flex-col", className)}>
      <span className="text-[1.1rem] font-semibold text-muted-foreground">Not available</span>
      <span className="text-[12px] text-muted-foreground">{reason}</span>
    </span>
  );
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
  /** Narrowest the table may get on wide screens before it scrolls inside its card. Defaults to tableMinWidth(columns). */
  minWidth?: number;
};

/**
 * 1163: the floor under a table's width. The old fixed 640px forced two-column tables inside half-width cards
 * to scroll sideways, which hid their last column (the Notifications "Count" column vanished off-screen).
 * Roughly 128px per column, never below 240 and never above 640.
 */
export const tableMinWidth = (columns: number) => Math.min(640, Math.max(240, columns * 160));

/**
 * The admin data table. From 640px up it is a normal table that scrolls inside its card if the card is narrower
 * than it (never the page). On phones it turns into labelled cards (or a pinned-column scroller, see `mobile`).
 * Labels are read from `head`, so every page gets the phone layout without changing how it writes its rows.
 */
export function Table({ head, children, className, label = "Table", mobile = "cards", lead = 0, minWidth }: TableProps) {
  const width = minWidth ?? tableMinWidth(head.length);
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
    // 1188: the row's key is its identity across a filter, sort or page change, so Flip can glide it from
    // its old place to its new one (lib/motion/flip.ts). Pages write <tr key={record.id}>; nothing else to do.
    return React.cloneElement(row as React.ReactElement<Record<string, unknown>>, { role: "row", "data-flip-id": row.key ?? undefined }, cells);
  });
  return (
    <ScrollX label={label} className={cn("atable -mx-5 px-5 sm:-mx-6 sm:px-6", mobile === "cards" ? "atable--cards" : "atable--scroll pin-first", className)}>
      <table role="table" className="w-full border-separate border-spacing-0 text-[13.5px]" style={{ minWidth: width }}>
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
