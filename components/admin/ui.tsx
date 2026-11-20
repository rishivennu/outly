import * as React from "react";
import { AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollX } from "@/components/ui/scroll-x";
import { Skeleton } from "@/components/shared/Skeleton";
import { Button } from "@/components/ui/button";
import { PLATFORM_STATUS } from "@/lib/admin/platform-status";

/** Server-safe building blocks for admin pages. */
/** `tight` is for working consoles (1191: Live Assist), where the screen below needs the height more than the title does. */
export function PageHead({ eyebrow, greet, title, body, actions, tight }: { eyebrow?: string; greet?: React.ReactNode; title: string; body?: React.ReactNode; actions?: React.ReactNode; tight?: boolean }) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-4", tight ? "mb-4" : "mb-7")}>
      <div className="min-w-0">
        {greet && <div className="mb-3">{greet}</div>}
        {eyebrow && <p className="eyebrow mb-2 text-[11px]">{eyebrow}</p>}
        <h1 className="text-[26px] font-[650] leading-[1.2] tracking-[-0.01em] sm:text-[28px] lg:text-[30px]">{title}</h1>
        {body && <p className="mt-1.5 max-w-prose text-[14px] leading-relaxed text-muted-foreground sm:text-[15px]">{body}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * R1275: the surface lives in CSS (.admin-card: card fill, a low-alpha line, a soft shadow). `tone="flat"` is a card
 * inside a card, `tone="float"` a panel over media; `interactive` marks a clickable card so it answers hover.
 */
export function Card({ className, children, as: As = "section", tone = "default", interactive = false, ...p }: { className?: string; children: React.ReactNode; as?: "section" | "div" | "article"; tone?: "default" | "flat" | "float"; interactive?: boolean } & React.HTMLAttributes<HTMLElement>) {
  return (
    <As className={cn("admin-card rounded-[24px] p-5 sm:p-6", tone === "default" && "bg-card", tone === "flat" && "admin-card--flat", tone === "float" && "admin-card--float", className)} data-interactive={interactive ? "" : undefined} {...p}>
      {children}
    </As>
  );
}

export function CardTitle({ children, hint, action }: { children: React.ReactNode; hint?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-[16px] font-semibold leading-[1.35]">{children}</h2>
        {hint && <p className="mt-0.5 text-[13px] leading-normal text-muted-foreground">{hint}</p>}
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
  return <span className={cn("inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium", TONES[tone], className)}>{children}</span>;
}

/**
 * 1163: one status vocabulary for the whole panel. A page passes the machine value it stores; the badge
 * shows the agreed label and tone, so "skipped" reads "Held back" on every screen and a platform's state uses
 * the same seven words everywhere. Unknown values fall back to the raw text in a neutral badge.
 */
/**
 * R1270: `dot` gives the dot its own tone where the word and the dot should differ (a suspended account reads
 * muted but its dot is red); `strong` adds a ring for the states a reader must act on.
 */
export type StatusEntry = { label: string; tone: Tone; dot?: Tone; strong?: boolean };
export const STATUS_LABEL: Record<string, StatusEntry> = {
  // platform and integration configuration
  configured: { label: "Configured", tone: "info" },
  connected: { label: "Connected", tone: "ok" },
  live: { label: "Live", tone: "ok" },
  "keys-missing": PLATFORM_STATUS["keys-missing"],
  hidden: PLATFORM_STATUS.hidden,
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
  suspended: { label: "Suspended", tone: "muted", dot: "bad" },
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
  // R1270: the semantic set every admin page can rely on (statusOf maps raw database values onto these)
  waiting: { label: "Waiting", tone: "warn" },
  completed: { label: "Completed", tone: "ok" },
  attention: { label: "Requires attention", tone: "warn", strong: true },
  retrying: { label: "Retrying", tone: "warn" },
  paid: { label: "Paid", tone: "ok" },
};

const SYNONYMS: Record<string, string> = {
  ok: "active", enabled: "active", on: "active", success: "succeeded", successful: "succeeded",
  error: "failed", errored: "failed", failure: "failed", fail: "failed",
  complete: "completed", finished: "completed", closed: "resolved",
  disabled: "suspended", inactive: "suspended", blocked: "suspended", banned: "suspended", off: "paused",
  awaiting: "waiting", in_progress: "running", processing: "running",
  needs_attention: "attention", requires_attention: "attention", action_required: "attention", warning: "attention",
  cancelled: "canceled", retry: "retrying",
};

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * R1270: a raw database or API value as a STATUS_LABEL key: trimmed, lower case, spaces and dashes as
 * underscores, common synonyms folded ("ok" and "enabled" are active, "error" is failed). An unknown value comes
 * back cleaned, so StatusBadge still prints it in a neutral badge.
 */
export function statusOf(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().toLowerCase();
  if (has(STATUS_LABEL, s)) return s;
  const k = s.replace(/[\s-]+/g, "_");
  if (has(STATUS_LABEL, k)) return k;
  if (has(SYNONYMS, k)) return SYNONYMS[k];
  const dashed = k.replace(/_/g, "-");
  return has(STATUS_LABEL, dashed) ? dashed : s;
}

const DOT: Record<Tone, string> = {
  lime: "bg-lime-ink",
  ok: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
  info: "bg-accent",
  muted: "bg-muted-foreground",
};

/**
 * Always a dot and a word, never colour alone. `size="sm"` is the table-row size. The status is looked up as
 * given (a page that passes a raw value wraps it in statusOf), so existing screens keep their words.
 */
export function StatusBadge({ status, label, className, size = "md" }: { status: string; label?: React.ReactNode; className?: string; size?: "sm" | "md" }) {
  const s = has(STATUS_LABEL, status) ? STATUS_LABEL[status] : undefined;
  return (
    <Pill tone={s?.tone ?? "muted"} className={cn(size === "sm" && "h-5 gap-1.5 px-2 text-[12px]", size === "md" && "gap-1.5", s?.strong && "ring-1 ring-inset ring-warning/40", className)}>
      <span data-dot="" aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[s?.dot ?? s?.tone ?? "muted"])} />
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
      <button type="button" aria-label={label} className="relative grid h-6 w-6 place-items-center rounded-full text-muted-foreground touch:before:absolute touch:before:-inset-2.5 touch:before:rounded-full touch:before:content-[''] [@media(hover:hover)]:hover:bg-secondary [@media(hover:hover)]:hover:text-foreground">
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
          <h2 id={id ? `${id}-title` : undefined} className="text-[20px] font-semibold leading-[1.3]">{title}</h2>
          {hint && <p className="mt-0.5 text-[13px] text-muted-foreground">{hint}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={cn("grid gap-3", grid)}>{children}</div>
    </section>
  );
}

/**
 * A card-shaped placeholder with the same radius and padding as the card it stands in for. R1270: `shape` picks
 * what it stands in for: "lines" (a KPI or text card), "cards" (a grid of cards, `lines` of them) or "table"
 * (a header and `lines` rows). The shared Skeleton shimmer stops under reduced motion (globals.css).
 */
export function LoadingState({ lines = 3, className, label = "Loading", shape = "lines" }: { lines?: number; className?: string; label?: string; shape?: "lines" | "cards" | "table" }) {
  if (shape === "cards") {
    return (
      <div role="status" aria-live="polite" aria-busy="true" className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-3", className)}>
        <span className="sr-only">{label}</span>
        {Array.from({ length: Math.max(1, lines) }, (_, i) => (
          <div key={i} className="admin-card space-y-3 rounded-[24px] bg-card p-5 sm:p-6">
            <Skeleton className="h-4 w-28 rounded-lg" />
            <Skeleton className="h-8 w-36 rounded-xl" />
            <Skeleton className="h-3.5 w-4/5 rounded-lg" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cn("admin-card rounded-[24px] bg-card p-5 sm:p-6", className)}>
      <span className="sr-only">{label}</span>
      {shape === "table" ? (
        <div className="space-y-0" aria-hidden>
          <Skeleton className="mb-3 h-3 w-1/3 rounded-full" />
          {Array.from({ length: Math.max(1, lines) }, (_, i) => (
            <div key={i} className="flex items-center gap-4 border-t border-border/60 py-3.5">
              <Skeleton className="h-3.5 w-1/3 rounded-lg" />
              <Skeleton className="h-3.5 w-1/4 rounded-lg" />
              <Skeleton className="ml-auto h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3" aria-hidden>
          <Skeleton className="h-4 w-32 rounded-lg" />
          <Skeleton className="h-8 w-40 rounded-xl" />
          {Array.from({ length: Math.max(0, lines - 2) }, (_, i) => (
            <div key={i} className="skeleton h-3.5 rounded-lg" style={{ width: `${88 - i * 14}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * What a card shows when its data could not be loaded: the fact, the cause in plain words, and a way to retry.
 * Never a zero and never a guess (brief 9: no mock data on failure).
 */
export function ErrorState({ title = "Couldn't load this", body, retry, retryHref, retryLabel = "Try again", children, className }: { title?: string; body?: string; retry?: React.ReactNode; /** R1270: a link that reloads the data (server pages), drawn as the shared lime Button. */ retryHref?: string; retryLabel?: string; children?: React.ReactNode; className?: string }) {
  const again = retry ?? (retryHref ? (
    <Button asChild variant="lime" size="sm">
      <a href={retryHref}>{retryLabel}</a>
    </Button>
  ) : null);
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-2 rounded-2xl bg-destructive/[0.06] px-5 py-5", className)}>
      <p className="flex items-center gap-2 text-[15px] font-semibold">
        <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden /> {title}
      </p>
      {body && <p className="max-w-prose text-[13px] leading-relaxed text-muted-foreground">{body}</p>}
      {(again || children) && <div className="mt-1 flex flex-wrap items-center gap-2">{again}{children}</div>}
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

/** Nothing to show yet: an optional icon, what is missing, why or what to do, and at most one action. */
export function Empty({ title, body, children, icon, action, className }: { title: string; body?: string; children?: React.ReactNode; icon?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/70 px-6 py-12 text-center", className)}>
      {icon && <span aria-hidden="true" className="mb-1 grid h-11 w-11 place-items-center rounded-full bg-secondary text-muted-foreground [&_svg]:h-5 [&_svg]:w-5">{icon}</span>}
      <p className="text-[15px] font-semibold leading-[1.35]">{title}</p>
      {body && <p className="max-w-sm text-[13px] leading-normal text-muted-foreground">{body}</p>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
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
  /** R1270: per-column alignment; "right" also sets tabular figures (numeric columns). Phone cards stay left aligned. */
  align?: ("left" | "right" | "center" | undefined)[];
  /** R1270: pin the first column while the table scrolls sideways from 640px up ("scroll" mode always pins it). */
  stickyFirst?: boolean;
};

const ALIGN = { left: "", right: "text-right tabular-nums", center: "text-center" } as const;

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
export function Table({ head, children, className, label = "Table", mobile = "cards", lead = 0, minWidth, align, stickyFirst = false }: TableProps) {
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
      const a = kind === "full" ? undefined : align?.[i];
      // Explicit roles keep the table semantics when the phone layout turns rows into grid cards.
      return React.cloneElement(cell as React.ReactElement<Record<string, unknown>>, {
        role: cell.type === "th" ? "rowheader" : "cell",
        "data-cell": kind,
        "data-label": kind === "field" ? (cell.props["data-label"] ?? labels[i] ?? undefined) : undefined,
        ...(a && ALIGN[a] ? { className: cn((cell.props as { className?: string }).className, ALIGN[a]) } : null),
      });
    });
    // 1188: the row's key is its identity across a filter, sort or page change, so Flip can glide it from
    // its old place to its new one (lib/motion/flip.ts). Pages write <tr key={record.id}>; nothing else to do.
    return React.cloneElement(row as React.ReactElement<Record<string, unknown>>, { role: "row", "data-flip-id": row.key ?? undefined }, cells);
  });
  return (
    <ScrollX label={label} className={cn("atable -mx-5 px-5 sm:-mx-6 sm:px-6", mobile === "cards" ? "atable--cards" : "atable--scroll pin-first", mobile === "cards" && stickyFirst && "pin-first atable--pin", className)}>
      <table role="table" className="w-full border-separate border-spacing-0 text-[13.5px]" style={{ minWidth: width }}>
        <thead role="rowgroup">
          <tr role="row">
            {head.map((h, i) => (
              <th key={i} scope="col" role="columnheader" data-kind={kinds[i]} className={cn("border-b border-border/70 pb-2.5 pr-4 text-left text-[12px] font-semibold tracking-normal text-muted-foreground last:pr-0", align?.[i] && ALIGN[align[i]!])}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup" className="[&_td]:tabular-nums [&_td]:border-b [&_td]:border-border/60 [&_td]:py-3 [&_td]:pr-4 [&_td:last-child]:pr-0 [&_tr:last-child_td]:border-0 [&_tr]:transition-colors [@media(hover:hover)]:[&_tr:hover]:bg-foreground/[0.03]">
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
