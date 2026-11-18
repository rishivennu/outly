"use client";
import { fmtHandle } from "@/lib/handle";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowDown, ArrowLeft, BarChart3, BellRing, Check, CheckCheck, Clock, Headset, Loader2, Maximize2, Minimize2, PanelRight, Plug, RotateCcw, Send, StickyNote, UserRound, Volume2, VolumeX, X } from "lucide-react";
import { useToast } from "@/components/shared/Toast";
import { Pill, STATUS_LABEL, ago, fmtDate, type Tone } from "@/components/admin/ui";
import { BRAND_PATH, BrandGlyph } from "@/components/brand/brands";
import { chime, setSound, soundOn, SOUND_EVENT } from "@/lib/client/live-sound";
import { adminPushFlag, disableAdminPush, enableAdminPush, syncAdminPush } from "@/lib/client/admin-push";
import { permission, pushSupport } from "@/lib/client/push";
import type { AdminRole } from "@/lib/admin/perms";
import { CATEGORY_LABEL, HISTORY_WORD, LIVE_CATEGORIES, LIVE_MAX_TEXT, LIVE_PRIORITIES, NOTE_MAX, STATUS_WORD, fmtDuration, mergeLive, receipt, staffSysLine, type LiveCategory, type Receipt, type SessionStatus, type WireMsg } from "@/lib/support/live-core";
import type { analytics, detail, queue, QueueFilter, QueueRow, QueueSort } from "@/lib/support/live";
import { cn } from "@/lib/utils";

/**
 * R1184 Live Assist console: the queue, one chat, and who the customer is, side by side on a desk and one at a
 * time on a phone (details in a drawer). Everything comes from the admin API, which re-checks role, ownership
 * and state on every call; this screen only shows what the server answered.
 *
 * Checking in: the queue every 6 s and the open chat every 3 s while someone is at the screen, slower for a
 * finished chat, and the queue every 20 s while the tab is in the background (so a new request can still chime
 * and raise a desktop alert). Nothing at all once nobody has touched the console for 30 minutes.
 *
 * 1191 rebuilt the screen on top of that, without touching a route, a payload or a rule: the counts are an even
 * grid, every control on the bar is the same height, the chat header splits into what-this-is / what-I-can-do /
 * how-it-is-filed so nothing overflows, the message column keeps day markers and a Latest button, the composer
 * is one growing line pinned above the home bar, and the details drawer is a proper phone dialog (full width,
 * focus kept inside, system back closes it, the page behind it does not scroll, quiet scrollbars).
 */

type QueueData = Awaited<ReturnType<typeof queue>> & { away: boolean; analytics: Awaited<ReturnType<typeof analytics>> | null; vapidPublicKey: string | null; pushDevices: number };
type Detail = Awaited<ReturnType<typeof detail>>;
type Msg = { key: string; sid?: string; seq?: number; cid?: string; pending?: boolean; failed?: boolean; role: WireMsg["role"]; text: string; author: string | null; at: string };

const IDLE_STOP = 30 * 60_000;
const Q_FAST = 6_000;
const Q_HIDDEN = 20_000;
// With nobody waiting or in a chat the queue checks in less often (Vercel CPU is metered).
const Q_CALM = 15_000;
const Q_CALM_HIDDEN = 45_000;
const D_OPEN = 3_000;
const D_DONE = 15_000;

const FILTERS: { value: QueueFilter; label: string }[] = [
  { value: "open", label: "All open" },
  { value: "waiting", label: "Waiting" },
  { value: "active", label: "Active" },
  { value: "mine", label: "Assigned to me" },
  { value: "unassigned", label: "Unassigned" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "Last 30 days" },
];
const SORTS: { value: QueueSort; label: string }[] = [
  { value: "priority", label: "Priority, then longest wait" },
  { value: "oldest", label: "Oldest first" },
  { value: "newest", label: "Newest first" },
  { value: "activity", label: "Latest message" },
];
const PRIORITY_LABEL: Record<string, string> = { normal: "Normal", high: "High", urgent: "Urgent" };
const PRIORITY_TONE: Record<string, Tone> = { normal: "muted", high: "warn", urgent: "bad" };
const STATUS_TONE: Record<string, Tone> = { waiting: "warn", active: "ok", resolved: "info", cancelled: "muted", returned: "muted", ticket: "muted" };
const statusWord = (s: string) => STATUS_WORD[s as SessionStatus] ?? s;
const catWord = (c: string) => CATEGORY_LABEL[c as LiveCategory] ?? c;
const isOpen = (s: string) => s === "waiting" || s === "active";
const ring = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))]";
const btn = cn("inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50", ring);
const btnPrimary = cn(btn, "bg-foreground text-background hover:bg-foreground/90");
const btnQuiet = cn(btn, "bg-secondary text-foreground hover:bg-secondary/70");
const btnDanger = cn(btn, "bg-destructive text-destructive-foreground hover:bg-destructive/90");
const field = cn("min-h-11 rounded-2xl border border-border bg-background px-3 text-[13px]", ring);
// One shape for every control on the bar and in the chat header, so a row of them lines up at any width.
const btnChip = cn(btn, "px-3.5");
const iconBtn = "w-11 shrink-0 px-0";
const pickField = cn(field, "w-full min-w-0");
const pickLabel = "flex min-w-0 flex-col gap-1 text-[11px] font-medium text-muted-foreground";
const H3 = "mb-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";
const DL = "grid grid-cols-[minmax(5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]";
const wrapAny = "break-words [overflow-wrap:anywhere]";
const reduceMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

class CallError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/** Admin API call. A finished admin session goes back to the admin sign-in, not the studio's. */
async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = `/admin/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  }
  if (!res.ok) throw new CallError(res.status, (data as { error?: string }).error ?? "That didn't go through. Try again.", (data as { code?: string }).code);
  return data as T;
}

const newCid = () => {
  try {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
};
const toMsg = (m: WireMsg): Msg => ({ key: m.id, sid: m.id, seq: m.seq ?? undefined, cid: m.cid ?? undefined, role: m.role, text: m.text, author: m.author, at: m.at });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

/** Last time someone used the console (pointer, keys, scroll, coming back to the tab). */
function useActivity() {
  const at = useRef(Date.now());
  useEffect(() => {
    const mark = () => {
      at.current = Date.now();
    };
    const evs = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "focus"];
    for (const e of evs) window.addEventListener(e, mark, { passive: true, capture: true });
    const vis = () => document.visibilityState === "visible" && mark();
    document.addEventListener("visibilitychange", vis);
    return () => {
      for (const e of evs) window.removeEventListener(e, mark, { capture: true });
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);
  return at;
}

/** Re-renders every `ms` so wait times keep counting between checks. */
function useNow(ms = 5_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function Avatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };
  if (src && !broken)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size} height={size} style={style} onError={() => setBroken(true)} className="shrink-0 rounded-full object-cover" />;
  return (
    <span aria-hidden style={style} className="grid shrink-0 place-items-center rounded-full bg-lime/20 text-[12px] font-bold text-lime-ink">
      {initials(name)}
    </span>
  );
}

function Counter({ label, n, on, onClick, tone }: { label: string; n: number; on: boolean; onClick: () => void; tone?: "warn" }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex h-full min-h-[4.5rem] flex-col items-start justify-between gap-1 rounded-2xl border px-3.5 py-2.5 text-left transition-colors",
        on ? "border-foreground/40 bg-foreground/[0.06]" : "border-border hover:bg-secondary/60",
        ring,
      )}
    >
      <span className="text-[11.5px] font-medium leading-tight text-muted-foreground">{label}</span>
      <span className={cn("font-display text-[1.4rem] font-semibold leading-none tabular-nums", tone === "warn" && n > 0 && "pill-ink-warn")}>{n}</span>
    </button>
  );
}

function QueueList({ rows, sel, onPick, now, meId, loading }: { rows: QueueRow[]; sel: string | null; onPick: (id: string) => void; now: number; meId: string; loading: boolean }) {
  if (loading) return <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">Loading the queue</p>;
  if (!rows.length)
    return (
      <div className="px-5 py-10 text-center">
        <p className="font-display text-[15px] font-semibold">Nobody here</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">New requests from Pip show up here straight away, with a chime if sound is on.</p>
      </div>
    );
  return (
    <ul className="flex flex-col gap-1 p-2" aria-label="Chats">
      {rows.map((r) => {
        const name = r.customer?.name || "Customer";
        const wait = isOpen(r.status) && !r.acceptedAt ? now - new Date(r.requestedAt).getTime() : r.waitMs;
        const on = sel === r.id;
        return (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onPick(r.id)}
              aria-current={on ? "true" : undefined}
              className={cn("flex w-full gap-3 rounded-2xl px-3 py-3 text-left transition-colors", on ? "bg-foreground/[0.07]" : "hover:bg-secondary/60", ring)}
            >
              <span className="relative">
                <Avatar name={name} src={r.customer?.avatar} />
                {r.online && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background bg-success" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[13.5px] font-semibold">{name}</span>
                  {r.unread > 0 && (
                    <span className="grid h-5 min-w-5 place-items-center rounded-full bg-lime px-1.5 text-[10.5px] font-bold text-[hsl(var(--lime-foreground))]" aria-label={`${r.unread} unread`}>
                      {r.unread > 99 ? "99+" : r.unread}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{isOpen(r.status) ? fmtDuration(wait) : ago(r.endedAt ?? r.lastMessageAt)}</span>
                </span>
                <span className="block truncate text-[11.5px] text-muted-foreground">{r.customer?.email ?? "Account removed"}</span>
                <span className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-foreground/80">{r.typing ? "Typing a message" : r.preview || "No message yet"}</span>
                <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Pill tone={STATUS_TONE[r.status] ?? "muted"}>{statusWord(r.status)}</Pill>
                  {r.priority !== "normal" && <Pill tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABEL[r.priority] ?? r.priority}</Pill>}
                  <Pill>{catWord(r.category)}</Pill>
                  <span className="text-[11px] text-muted-foreground">{r.agentName ? (r.agentId === meId ? "You" : r.agentName) : "Unassigned"}</span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col gap-0.5 rounded-2xl border border-border px-3.5 py-2.5">
      <p className="text-[11.5px] leading-tight text-muted-foreground">{label}</p>
      <p className="font-display text-[1.2rem] font-semibold leading-none tabular-nums">{value}</p>
      {hint && <p className="mt-auto text-[11px] leading-tight text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Reports({ data, days, setDays }: { data: QueueData["analytics"]; days: number; setDays: (d: number) => void }) {
  return (
    <section aria-labelledby="la-reports" className="rounded-[22px] border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="la-reports" className="font-display text-[15px] font-semibold">
          Reports
        </h2>
        <div className="flex gap-1" role="group" aria-label="Period">
          {[1, 7, 30, 90].map((d) => (
            <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={cn(btn, "px-3 text-[12px]", days === d ? "bg-foreground text-background" : "bg-secondary text-foreground hover:bg-secondary/70")}>
              {d === 1 ? "Today" : `${d} days`}
            </button>
          ))}
        </div>
      </div>
      {!data ? (
        <p className="text-[13px] text-muted-foreground">Loading</p>
      ) : (
        <>
          <div className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            <Stat label="Requests" value={String(data.totals.total)} hint={data.truncated ? "First 5,000 counted" : undefined} />
            <Stat label="Resolved" value={String(data.totals.resolved)} />
            <Stat label="Still open" value={String(data.totals.unresolved)} hint={`${data.totals.waiting} waiting`} />
            <Stat label="Median wait" value={fmtDuration(data.wait.median)} hint={`${data.wait.n} accepted`} />
            <Stat label="Median first reply" value={fmtDuration(data.firstResponse.median)} hint={`${data.firstResponse.n} answered`} />
            <Stat label="Median to resolve" value={fmtDuration(data.resolution.median)} />
            <Stat label="Helpful" value={data.csat.pct == null ? "No ratings" : `${data.csat.pct}%`} hint={`${data.csat.helpful} of ${data.csat.rated} rated`} />
          </div>
          <p className="mt-2 text-[11.5px] text-muted-foreground">
            Ended early: {data.totals.cancelled} cancelled, {data.totals.returned} handed back to Pip, {data.totals.ticket} left a message.
          </p>
          {data.agents.length > 0 && (
            <div className="la-scroll mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-[12.5px]">
                <caption className="sr-only">By specialist</caption>
                <thead className="text-[11.5px] text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Specialist</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Chats</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Resolved</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Median first reply</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Median to resolve</th>
                    <th scope="col" className="py-1.5 font-medium">Helpful</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((a) => (
                    <tr key={a.agentId} className="border-t border-border/60">
                      <th scope="row" className="py-2 pr-3 font-medium">{a.name}</th>
                      <td className="py-2 pr-3 tabular-nums">{a.handled}</td>
                      <td className="py-2 pr-3 tabular-nums">{a.resolved}</td>
                      <td className="py-2 pr-3 tabular-nums">{fmtDuration(a.firstResponse)}</td>
                      <td className="py-2 pr-3 tabular-nums">{fmtDuration(a.resolution)}</td>
                      <td className="py-2 tabular-nums">{a.rated ? `${a.helpful} of ${a.rated}` : "None"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Confirm step for Resolve. Focus starts on the safe choice; Escape and the backdrop cancel. */
function Confirm({ title, body, yes, onYes, onNo, busy }: { title: string; body: string; yes: string; onYes: () => void; onNo: () => void; busy: boolean }) {
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onNo();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onNo]);
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/40 p-4" onPointerDown={(e) => e.target === e.currentTarget && onNo()}>
      <div role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-b`} className="glass-strong w-full max-w-sm rounded-[22px] p-5 shadow-2xl">
        <h2 id={`${id}-t`} className="font-display text-[16px] font-semibold">
          {title}
        </h2>
        <p id={`${id}-b`} className="mt-1.5 text-[13.5px] text-muted-foreground">
          {body}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button ref={cancel} type="button" onClick={onNo} className={btnQuiet}>
            Cancel
          </button>
          <button type="button" onClick={onYes} disabled={busy} className={btnPrimary}>
            {busy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
            {yes}
          </button>
        </div>
      </div>
    </div>
  );
}

const RECEIPT: Record<Receipt, { word: string; Icon: typeof Check }> = {
  sending: { word: "Sending", Icon: Clock },
  failed: { word: "Not sent", Icon: AlertTriangle },
  sent: { word: "Sent", Icon: Check },
  delivered: { word: "Delivered", Icon: CheckCheck },
  read: { word: "Seen", Icon: CheckCheck },
};

/** The day a message belongs to, in the console's own clock, so a marker only appears when the date really turns. */
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
function dayWord(iso: string) {
  const d = dayOf(iso);
  if (d === dayOf(new Date().toISOString())) return "Today";
  if (d === dayOf(new Date(Date.now() - 86_400_000).toISOString())) return "Yesterday";
  return fmtDate(iso);
}

/** One message. Text is always rendered as text (React escapes it), never as HTML. */
function Line({ m, r, customer, onRetry }: { m: Msg; r: Receipt | null; customer: string; onRetry: (m: Msg) => void }) {
  // Automated lines (joined, handed back, transferred) are the console talking, so they read as a quiet
  // centred note with a dashed edge, never as anybody's message.
  if (m.role === "system")
    return (
      <li className="my-1 flex justify-center">
        <span className={cn("max-w-[90%] rounded-full border border-dashed border-border bg-secondary/60 px-3 py-1 text-center text-[11.5px] text-muted-foreground", wrapAny)}>
          {staffSysLine(m.text) ?? m.text} <span aria-hidden>&middot;</span> <time dateTime={m.at}>{time(m.at)}</time>
        </span>
      </li>
    );
  const ours = m.role !== "user";
  const who = m.role === "user" ? customer : m.role === "pip" ? "Pip" : m.author || "Specialist";
  const R = r ? RECEIPT[r] : null;
  return (
    <li className={cn("flex flex-col gap-1", ours ? "items-end" : "items-start")}>
      <span className="px-1 text-[11px] text-muted-foreground">
        {who} <span aria-hidden>&middot;</span> <time dateTime={m.at}>{time(m.at)}</time>
      </span>
      <div
        className={cn(
          "max-w-[min(85%,38rem)] whitespace-pre-wrap rounded-[18px] px-3.5 py-2 text-[13.5px] leading-relaxed",
          wrapAny,
          m.role === "agent" ? "bg-foreground text-background" : m.role === "pip" ? "border border-border bg-lime/10" : "bg-secondary",
          (m.pending || m.failed) && "opacity-70",
        )}
      >
        {m.text}
      </div>
      {R &&
        (r === "failed" ? (
          <button type="button" onClick={() => onRetry(m)} className={cn("inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-[11.5px] font-semibold text-destructive hover:underline", ring)}>
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Not sent. Try again
          </button>
        ) : (
          <span className={cn("inline-flex items-center gap-1 px-1 text-[11px]", r === "read" ? "text-foreground" : "text-muted-foreground")}>
            <R.Icon className="h-3.5 w-3.5" aria-hidden /> {R.word}
          </span>
        ))}
    </li>
  );
}

type Info = NonNullable<Detail["customer"]>;

const isBrand = (p: string): p is keyof typeof BRAND_PATH => p in BRAND_PATH;
/** Each platform spelled the way it spells itself: a capitalised column value reads as "Youtube". */
const PLAT_LABEL: Record<string, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", x: "X", threads: "Threads", facebook: "Facebook", linkedin: "LinkedIn", buffer: "Buffer", hootsuite: "Hootsuite" };

/**
 * A connected platform's state. The three the drawer has to be unmistakable about are spelled out here, because a
 * specialist reads them mid-chat: connected is green, waiting is neutral, a broken link is amber. Anything else
 * falls back to the panel's shared vocabulary (1163), so one stored word never reads two ways across admin screens.
 */
function accountState(status: string): { label: string; tone: Tone } {
  const s = status.toLowerCase();
  if (s === "connected" || s === "active") return { label: "Connected", tone: "ok" };
  if (s === "pending" || s === "pending_approval") return { label: "Waiting", tone: "muted" };
  if (s === "disconnected" || s === "revoked" || s === "expired") return { label: "Disconnected", tone: "warn" };
  if (s === "needs_reconnect" || s === "requires_reconnect") return { label: "Requires reconnect", tone: "warn" };
  return STATUS_LABEL[s] ?? { label: status, tone: "muted" };
}

/** One label and value in a details list. The value wraps; a long id or email never pushes the drawer sideways. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 font-medium", wrapAny)}>{children}</dd>
    </>
  );
}

/** Who the customer is, this chat's facts, staff notes and the assignment history. */
function Details({ d, info, onOpen, onNote }: { d: Detail; info: Info | null; onOpen: (id: string) => void; onNote: (body: string) => Promise<boolean> }) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(savedT.current), []);
  const s = d.session;
  const u = info?.user;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim() || saving) return;
    setSaving(true);
    if (await onNote(note)) {
      setNote("");
      setSaved(true);
      clearTimeout(savedT.current);
      savedT.current = setTimeout(() => setSaved(false), 3000);
    }
    setSaving(false);
  };
  const firstReply = s.firstResponseAt ? fmtDuration(new Date(s.firstResponseAt).getTime() - new Date(s.acceptedAt ?? s.requestedAt).getTime()) : "None yet";
  return (
    <div className="flex flex-col gap-5 px-4 pb-6 pt-4">
      <section aria-labelledby="la-who">
        <h3 id="la-who" className={H3}>Customer</h3>
        {u ? (
          <>
            <div className="flex items-center gap-3">
              <Avatar name={u.name || u.email} src={u.avatar} size={44} />
              <div className="min-w-0">
                <p className={cn("text-[14.5px] font-semibold leading-tight", wrapAny)}>{u.name || "No name"}</p>
                <p className={cn("text-[12.5px] leading-snug text-muted-foreground", wrapAny)}>{u.email}</p>
              </div>
            </div>
            <dl className={cn(DL, "mt-3")}>
              <Row label="Joined">{fmtDate(u.createdAt)}{u.country ? `, ${u.country}` : ""}</Row>
              <Row label="Last seen">{d.online ? "On the chat now" : ago(u.lastSeenAt)}</Row>
              <Row label="Time zone">{u.timezone}</Row>
            </dl>
            <Link href={`/admin/users?q=${encodeURIComponent(u.email)}`} className={cn(btnQuiet, "mt-3 w-full")}>
              Open in Users
            </Link>
          </>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">{info ? "This account was removed." : "Loading"}</p>
        )}
      </section>

      {info && (
        <section aria-labelledby="la-plan">
          <h3 id="la-plan" className={H3}>Plan and platforms</h3>
          <p className={cn("text-[12.5px]", wrapAny)}>
            {info.plan ? (
              <>
                <span className="font-semibold">{info.plan.name}</span>, {info.plan.interval === "year" ? "yearly" : "monthly"}
                {info.plan.gift ? " (gifted)" : ""}. {info.plan.cancelling ? "Ends" : "Renews"} {fmtDate(info.plan.renews)}.
              </>
            ) : (
              "Free plan"
            )}
          </p>
          {info.accounts.length ? (
            <ul className="mt-2.5 flex flex-col gap-1.5">
              {info.accounts.map((a, i) => {
                const st = accountState(a.status);
                return (
                  <li key={`${a.platform}-${i}`} className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-secondary text-foreground/70">
                      {isBrand(a.platform) ? <BrandGlyph brand={a.platform} className="h-4 w-4" /> : <Plug className="h-4 w-4" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium">{PLAT_LABEL[a.platform] ?? a.platform}</span>
                      <span className="block truncate text-[11.5px] text-muted-foreground">{fmtHandle(a.username)}</span>
                    </span>
                    <Pill tone={st.tone} className="shrink-0">{st.label}</Pill>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">No platforms connected</p>
          )}
        </section>
      )}

      <section aria-labelledby="la-this">
        <h3 id="la-this" className={H3}>This chat</h3>
        <dl className={DL}>
          <Row label="Asked">{fmtDate(s.requestedAt, true)}</Row>
          <Row label="Waited">{fmtDuration(s.waitMs)}</Row>
          <Row label="First reply">{firstReply}</Row>
          {s.endedAt && <Row label="Ended">{fmtDate(s.endedAt, true)}{s.endedBy ? ` by ${s.endedBy}` : ""}</Row>}
          <Row label="Rating">{s.csat == null ? "Not rated" : s.csat > 0 ? "Helpful" : "Not helpful"}</Row>
          <Row label="Conversation">{d.conversation.ref}</Row>
          {s.ticketId && (
            <Row label="Ticket">
              <Link href={`/admin/tickets/${s.ticketId}`} className={cn("font-semibold underline-offset-2 hover:underline", ring)}>
                Open the ticket
              </Link>
            </Row>
          )}
        </dl>
      </section>

      <section aria-labelledby="la-notes">
        <h3 id="la-notes" className={H3}>
          <StickyNote className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
          Notes, visible only to the team
        </h3>
        {d.notes.length > 0 && (
          <ul className="mb-2.5 flex flex-col gap-2">
            {d.notes.map((n) => (
              <li key={n.id} className="rounded-2xl bg-warning/10 px-3 py-2 text-[12.5px]">
                <p className={cn("whitespace-pre-wrap", wrapAny)}>{n.body}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {n.author}, {ago(n.at)}
                </p>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={save} className="flex flex-col gap-2">
          <label htmlFor="la-note" className="sr-only">
            New note, only your team can see it
          </label>
          <textarea
            id="la-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={NOTE_MAX}
            rows={3}
            placeholder="What should the next person on this chat know? The customer never sees this."
            className={cn(field, "la-scroll min-h-[5rem] w-full resize-y py-2")}
          />
          <div className="flex items-center gap-2">
            <span role="status" className="min-w-0 flex-1 text-[11.5px] text-muted-foreground">
              {saved ? "Note saved." : note.length > NOTE_MAX - 100 ? `${note.length} of ${NOTE_MAX}` : ""}
            </span>
            <button type="submit" disabled={!note.trim() || saving} className={btnQuiet}>
              {saving && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
              {saving ? "Saving" : "Add note"}
            </button>
          </div>
        </form>
      </section>

      {info && (info.tickets.length > 0 || info.past.length > 0) && (
        <section aria-labelledby="la-past">
          <h3 id="la-past" className={H3}>Before this</h3>
          <ul className="flex flex-col gap-1 border-l border-border/70 pl-3 text-[12.5px]">
            {info.tickets.map((t) => (
              <li key={t.id} className="relative">
                <span className="absolute -left-[1.03rem] top-[1.15rem] h-1.5 w-1.5 rounded-full bg-muted-foreground/50" aria-hidden />
                <Link href={`/admin/tickets/${t.id}`} className={cn("flex min-h-11 flex-col justify-center gap-0.5 rounded-xl px-2 py-1.5 hover:bg-secondary/60", ring)}>
                  <span className="flex items-center gap-2">
                    <span className={cn("min-w-0 flex-1 truncate font-medium", wrapAny)}>{t.subject}</span>
                    <Pill tone={t.status === "resolved" ? "muted" : "warn"} className="shrink-0">{t.status}</Pill>
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Ticket {t.ref} <span aria-hidden>&middot;</span> {fmtDate(t.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
            {info.past.map((p) => (
              <li key={p.id} className="relative">
                <span className="absolute -left-[1.03rem] top-[1.15rem] h-1.5 w-1.5 rounded-full bg-muted-foreground/50" aria-hidden />
                <button type="button" onClick={() => onOpen(p.id)} className={cn("flex min-h-11 w-full flex-col justify-center gap-0.5 rounded-xl px-2 py-1.5 text-left hover:bg-secondary/60", ring)}>
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">Live chat, {catWord(p.category).toLowerCase()}</span>
                    <Pill tone={STATUS_TONE[p.status] ?? "muted"} className="shrink-0">{statusWord(p.status)}</Pill>
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {fmtDate(p.requestedAt)}
                    {p.agentName ? ` with ${p.agentName}` : ""}
                    {p.csat == null ? "" : p.csat > 0 ? ", rated helpful" : ", rated not helpful"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.history.length > 0 && (
        <section aria-labelledby="la-hist">
          <h3 id="la-hist" className={H3}>History</h3>
          <ol className="flex flex-col gap-1.5 text-[12px]">
            {d.history.map((h) => (
              <li key={h.id} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />
                <span className={wrapAny}>
                  {HISTORY_WORD[h.action] ?? h.action}
                  {h.by ? ` by ${h.by}` : ""}
                  {h.note ? `: ${h.note}` : ""} <span className="text-muted-foreground">{ago(h.at)}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

const notifySupported = () => typeof window !== "undefined" && "Notification" in window;
const SEL_ID = /^[A-Za-z0-9_-]{1,40}$/;

export function LiveAssistConsole({ me, role }: { me: { id: string; name: string }; role: AdminRole }) {
  const toast = useToast();
  const activity = useActivity();
  const now = useNow();
  const params = useSearchParams();
  const urlSel = params.get("s");
  const isSuper = role === "super";

  const [filter, setFilter] = useState<QueueFilter>("open");
  const [sort, setSort] = useState<QueueSort>("priority");
  const [cat, setCat] = useState("");
  const [prio, setPrio] = useState("");
  const [q, setQ] = useState<QueueData | null>(null);
  const [qErr, setQErr] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reports, setReports] = useState(false);
  const [days, setDays] = useState(7);
  const [sound, setSoundUi] = useState(false);
  const [perm, setPerm] = useState("unsupported");
  // R1207: phone alerts (Web Push) for this browser. True only when this browser is really subscribed and allowed.
  const [pushHere, setPushHere] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [d, setD] = useState<Detail | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [dErr, setDErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [text, setText] = useState("");
  // The chat can take the whole desk when the queue is not needed; the queue comes back with the same button.
  const [wide, setWide] = useState(false);
  const [atEnd, setAtEnd] = useState(true);
  const [sending, setSending] = useState(false);

  const selRef = useRef<string | null>(null);
  const cursor = useRef<number | null>(null);
  const qsRef = useRef("");
  const openRef = useRef(true);
  const seenWaiting = useRef<Set<string> | null>(null);
  const lastWaiting = useRef<number | null>(null);
  const busyQ = useRef(true);
  // Detail requests overlap (the poll, a refresh after an action); only the newest answer may paint the chat.
  const detailSeq = useRef(0);
  const detailShown = useRef(0);
  const startedAt = useRef(Date.now());
  const typedAt = useRef(0);
  const drafts = useRef(new Map<string, string>());
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const baseTitle = useRef<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const drawerBack = useRef(false);
  const painted = useRef(false);

  const pick = useCallback((id: string | null) => {
    setSel(id);
    const u = new URL(window.location.href);
    if (id) u.searchParams.set("s", id);
    else u.searchParams.delete("s");
    window.history.replaceState(window.history.state, "", u.pathname + u.search);
  }, []);

  // A link to one chat (the bell, a desktop alert, a shared URL) opens it, also while already on this page.
  useEffect(() => {
    if (urlSel && SEL_ID.test(urlSel) && urlSel !== selRef.current) setSel(urlSel);
  }, [urlSel]);

  useEffect(() => {
    setSoundUi(soundOn());
    setPerm(notifySupported() ? Notification.permission : "unsupported");
    if (adminPushFlag() && permission() === "granted") setPushHere(true);
    const on = (e: Event) => setSoundUi(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener(SOUND_EVENT, on);
    return () => window.removeEventListener(SOUND_EVENT, on);
  }, []);

  // R1207: this browser opted in before, so its subscription is re-saved when the console opens (it refreshes
  // "last seen" and brings it back after a reinstall). Never asks for permission on its own.
  const vapid = q?.vapidPublicKey ?? null;
  useEffect(() => {
    if (!vapid) return;
    void syncAdminPush(vapid).then((ok) => ok && setPushHere(true));
  }, [vapid]);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ filter, sort });
    if (cat) p.set("category", cat);
    if (prio) p.set("priority", prio);
    if (reports) p.set("analytics", String(days));
    return p.toString();
  }, [filter, sort, cat, prio, reports, days]);
  qsRef.current = qs;

  /** New requests chime (deduped with the bell by session id) and, when the tab isn't in front, raise a desktop alert. */
  const alertNew = useCallback(
    (data: QueueData) => {
      const waiting = data.items.filter((r) => r.status === "waiting");
      const seen = seenWaiting.current;
      const fresh = seen ? waiting.filter((r) => !seen.has(r.id) && new Date(r.requestedAt).getTime() > startedAt.current - 10_000) : [];
      const grew = lastWaiting.current != null && data.counts.waiting > lastWaiting.current;
      seenWaiting.current = new Set([...(seen ?? []), ...waiting.map((r) => r.id)]);
      lastWaiting.current = data.counts.waiting;
      if (!fresh.length && !grew) return;
      const urgent = fresh.some((r) => r.priority === "urgent");
      chime(urgent, fresh.map((r) => r.id));
      if (notifySupported() && Notification.permission === "granted" && (document.visibilityState !== "visible" || !document.hasFocus())) {
        try {
          const r = fresh[0];
          const n = new Notification(urgent ? "Urgent live chat" : "New live chat", {
            body: r ? `${r.customer?.name || "A customer"}: ${r.preview || catWord(r.category)}` : `${data.counts.waiting} waiting in Live Support`,
            tag: r ? `live-${r.id}` : "live-queue",
          });
          n.onclick = () => {
            window.focus();
            if (r) pick(r.id);
            n.close();
          };
        } catch {}
      }
    },
    [pick],
  );

  const loadQueue = useCallback(async () => {
    const key = qsRef.current;
    try {
      const data = await call<QueueData>(`/api/admin/live-assist?${key}`);
      if (key !== qsRef.current) return;
      setQ(data);
      setQErr(false);
      busyQ.current = data.counts.waiting + data.counts.active > 0;
      alertNew(data);
    } catch {
      setQErr(true);
    }
  }, [alertNew]);

  const loadDetail = useCallback(async (id: string, full = false) => {
    const p = new URLSearchParams();
    const after = full ? null : cursor.current;
    if (after != null) p.set("after", String(after));
    if (document.visibilityState === "visible") p.set("read", "1");
    const n = ++detailSeq.current;
    try {
      const r = await call<Detail>(`/api/admin/live-assist/${encodeURIComponent(id)}?${p}`);
      if (selRef.current !== id || n < detailShown.current) return;
      detailShown.current = n;
      cursor.current = Math.max(cursor.current ?? 0, r.cursor);
      setD(r);
      if (r.customer) setInfo(r.customer);
      setMsgs((m) => mergeLive(r.full ? m.filter((x) => x.pending || x.failed) : m, r.messages, toMsg));
      setDErr(null);
    } catch (e) {
      if (selRef.current !== id || n < detailShown.current) return;
      setDErr(e instanceof CallError && e.status === 404 ? "This chat isn't here any more." : e instanceof Error ? e.message : "Couldn't load this chat.");
    }
  }, []);

  // The queue: every 6 s at the screen and 20 s in a background tab while anyone waits or chats, 15 s and 45 s
  // when it's empty, nothing after 30 idle minutes.
  useEffect(() => {
    let stop = false;
    let inflight = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      inflight = true;
      const idle = Date.now() - activity.current > IDLE_STOP;
      setPaused(idle);
      if (!idle) await loadQueue();
      inflight = false;
      const shown = document.visibilityState === "visible";
      if (!stop) t = setTimeout(tick, busyQ.current ? (shown ? Q_FAST : Q_HIDDEN) : shown ? Q_CALM : Q_CALM_HIDDEN);
    };
    void tick();
    const vis = () => {
      if (document.visibilityState === "visible" && !inflight) {
        clearTimeout(t);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      stop = true;
      clearTimeout(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [qs, loadQueue, activity]);

  // The open chat: every 3 s while open and on screen, every 15 s once it ended.
  useEffect(() => {
    selRef.current = sel;
    cursor.current = null;
    stick.current = true;
    painted.current = false;
    drawerBack.current = false;
    setAtEnd(true);
    setD(null);
    setInfo(null);
    setMsgs([]);
    setDErr(null);
    setDrawer(false);
    setConfirm(false);
    setText(sel ? (drafts.current.get(sel) ?? "") : "");
    if (!sel) return;
    let stop = false;
    let inflight = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const tick = async (full = false) => {
      inflight = true;
      const idle = Date.now() - activity.current > IDLE_STOP;
      if (full || (!idle && document.visibilityState === "visible")) await loadDetail(sel, full);
      inflight = false;
      if (!stop) t = setTimeout(() => void tick(), openRef.current ? D_OPEN : D_DONE);
    };
    void tick(true);
    const vis = () => {
      if (document.visibilityState === "visible" && !inflight) {
        clearTimeout(t);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      stop = true;
      clearTimeout(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [sel, loadDetail, activity]);

  const s = d?.session ?? null;
  const open = s ? isOpen(s.status) : true;
  openRef.current = open;
  const mine = !!s && s.agentId === me.id;
  const mineActive = !!s && s.status === "active" && mine;
  const canManage = !!s && open && (s.status === "waiting" || mine || isSuper);
  const name = info?.user?.name || q?.items.find((r) => r.id === sel)?.customer?.name || "Customer";
  // "Wide" only means anything with a chat open: the queue steps aside and the chat takes its width.
  const wideNow = wide && !!sel;

  // Keep the newest message in view unless the specialist scrolled up to read: the chat lands at the bottom on
  // the first paint, glides for later messages, and jumps without animating for anyone who asked for less motion.
  useEffect(() => {
    const el = logRef.current;
    if (!el || !stick.current) return;
    const glide = painted.current && !reduceMotion();
    el.scrollTo({ top: el.scrollHeight, behavior: glide ? "smooth" : "auto" });
    painted.current = true;
  }, [msgs, d?.typing]);
  const onLogScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const end = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = end;
    setAtEnd((x) => (x === end ? x : end));
  };
  const toLatest = () => {
    stick.current = true;
    setAtEnd(true);
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion() ? "auto" : "smooth" });
  };
  // The composer grows with the reply up to a few lines, so the box and the send button stay on one line.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text, sel]);

  // Waiting count in the tab title, so a background tab still shows the queue.
  useEffect(() => {
    if (baseTitle.current == null) baseTitle.current = document.title;
    const n = q?.counts.waiting ?? 0;
    document.title = n ? `(${n}) ${baseTitle.current}` : baseTitle.current;
  }, [q?.counts.waiting]);
  useEffect(
    () => () => {
      if (baseTitle.current != null) document.title = baseTitle.current;
    },
    [],
  );

  /**
   * The details drawer is a dialog on a phone: the close button, Escape, the backdrop and the system back button
   * all shut it, Tab stays inside it, and the console behind it does not scroll while it is open.
   */
  const closeDrawer = useCallback(() => {
    setDrawer(false);
    if (!drawerBack.current) return;
    drawerBack.current = false;
    try {
      window.history.back();
    } catch {}
  }, []);
  const openDrawer = () => {
    setDrawer(true);
    try {
      window.history.pushState({ ...window.history.state, laDrawer: true }, "", window.location.href);
      drawerBack.current = true;
    } catch {
      drawerBack.current = false;
    }
  };
  const trapTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const root = panelRef.current;
    if (!root) return;
    const able = Array.from(root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, select, input, [tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null);
    if (!able.length) return;
    const first = able[0];
    const last = able[able.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  useEffect(() => {
    if (!drawer) return;
    panelRef.current?.focus();
    const root = document.documentElement;
    const was = root.style.overflow;
    root.style.overflow = "hidden";
    const k = (e: KeyboardEvent) => e.key === "Escape" && closeDrawer();
    const pop = () => {
      drawerBack.current = false;
      setDrawer(false);
    };
    document.addEventListener("keydown", k);
    window.addEventListener("popstate", pop);
    return () => {
      document.removeEventListener("keydown", k);
      window.removeEventListener("popstate", pop);
      root.style.overflow = was;
    };
  }, [drawer, closeDrawer]);

  const refresh = useCallback(async () => {
    const id = selRef.current;
    await Promise.all([loadQueue(), id ? loadDetail(id) : null]);
  }, [loadQueue, loadDetail]);

  /** Every change goes to the server, which decides; the screen then shows what actually happened. */
  const act = async (body: Record<string, unknown>, done?: string) => {
    const id = sel;
    if (!id) return null;
    setBusy(String(body.action));
    try {
      const r = await call<{ ok: boolean; already?: boolean; sessionId?: string }>(`/api/admin/live-assist/${encodeURIComponent(id)}`, body);
      if (done && !r.already) toast(done, "ok");
      return r;
    } catch (e) {
      toast(e instanceof Error ? e.message : "That didn't go through. Try again.", "error");
      return null;
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const accept = async () => {
    const r = await act({ action: "accept" }, "You joined the conversation. The customer can see it.");
    if (r) setTimeout(() => inputRef.current?.focus(), 50);
  };
  const takeover = async () => {
    const r = await act({ action: "takeover" }, "You took over this chat.");
    if (r) setTimeout(() => inputRef.current?.focus(), 50);
  };
  const reopen = async () => {
    const r = await act({ action: "reopen" }, "Reopened. You have the new chat.");
    if (r?.sessionId) pick(r.sessionId);
  };
  const closeConfirm = useCallback(() => setConfirm(false), []);

  const send = async (retry?: Msg) => {
    const id = sel;
    const body = (retry ? retry.text : text).trim();
    if (!id || !body || !mineActive) return;
    const cid = retry?.cid ?? newCid();
    if (retry) setMsgs((m) => m.map((x) => (x.cid === cid ? { ...x, pending: true, failed: false } : x)));
    else {
      setMsgs((m) => [...m, { key: `c-${cid}`, cid, pending: true, role: "agent", text: body, author: me.name, at: new Date().toISOString() }]);
      setText("");
      drafts.current.delete(id);
      stick.current = true;
    }
    typedAt.current = 0;
    setSending(true);
    try {
      const r = await call<{ message: WireMsg; duplicate: boolean }>(`/api/admin/live-assist/${encodeURIComponent(id)}`, { action: "send", text: body, cid });
      if (selRef.current === id) setMsgs((m) => mergeLive(m, [r.message], toMsg));
    } catch (e) {
      if (selRef.current === id) setMsgs((m) => m.map((x) => (x.cid === cid ? { ...x, pending: false, failed: true } : x)));
      toast(e instanceof Error ? e.message : "Not sent. Try again.", "error");
      if (e instanceof CallError && (e.status === 403 || e.status === 409)) void refresh();
    } finally {
      setSending(false);
    }
  };

  const onText = (v: string) => {
    setText(v);
    if (sel) drafts.current.set(sel, v);
    if (sel && mineActive && v.trim() && Date.now() - typedAt.current > 3000) {
      typedAt.current = Date.now();
      void call(`/api/admin/live-assist/${encodeURIComponent(sel)}`, { action: "typing" }).catch(() => {});
    }
  };

  const setField = (key: "priority" | "category", v: string, done: string) => {
    setD((x) => (x ? { ...x, session: { ...x.session, [key]: v } } : x));
    void act({ action: key, [key]: v }, done);
  };

  const toggleAway = async () => {
    if (!q) return;
    setBusy("away");
    try {
      const r = await call<{ away: boolean }>("/api/admin/live-assist", { action: "away", away: !q.away });
      setQ((x) => (x ? { ...x, away: r.away } : x));
      toast(r.away ? "You're away. Customers won't count you as online." : "You're back. Customers can see someone is online.", "info");
    } catch (e) {
      toast(e instanceof Error ? e.message : "That didn't go through.", "error");
    } finally {
      setBusy(null);
    }
  };

  const toggleSound = () => {
    const on = !sound;
    setSound(on);
    setSoundUi(on);
    if (on) chime();
  };

  /**
   * R1207: "Phone alerts" on this device. Permission is asked inside this tap (never on load), the subscription is
   * stored as an admin alert device, and from then on a new support request reaches this phone even with Outlly
   * closed. Tapping again removes this device only.
   */
  const togglePush = async () => {
    setBusy("push");
    try {
      if (pushHere) {
        await disableAdminPush();
        setPushHere(false);
        toast("Phone alerts are off on this device.", "ok");
      } else {
        if (pushSupport() === "ios-needs-install") throw new Error("On iPhone and iPad, add Outlly to the Home Screen first, then turn phone alerts on from the installed app.");
        if (!vapid) throw new Error("Web Push is not configured on the server (VAPID keys).");
        await enableAdminPush(vapid);
        setPushHere(true);
        toast("Phone alerts are on for this device. A new support request will reach you even with Outlly closed.", "ok");
      }
      void loadQueue();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't change phone alerts here.", "error");
    } finally {
      setBusy(null);
    }
  };

  const askAlerts = async () => {
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
      toast(p === "granted" ? "Desktop alerts are on for new chats." : "Desktop alerts are blocked. You can allow them in this site's browser settings.", p === "granted" ? "ok" : "info");
    } catch {}
  };

  let lastAgent = -1;
  for (let i = msgs.length - 1; i >= 0; i--)
    if (msgs[i].role === "agent" && !msgs[i].pending && !msgs[i].failed) {
      lastAgent = i;
      break;
    }
  const c = q?.counts;
  const online = q?.agents.filter((a) => a.online).length ?? 0;
  const counter = (f: QueueFilter) => () => setFilter((x) => (x === f ? "open" : f));

  const addNote = async (body: string) => {
    const id = sel;
    if (!id) return false;
    try {
      await call(`/api/admin/live-assist/${encodeURIComponent(id)}`, { action: "note", body });
      toast("Note saved. Only your team can see it.", "ok");
      void loadDetail(id);
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : "The note wasn't saved. Try again.", "error");
      return false;
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* The overview. On a phone an open chat owns the whole screen, so these step aside until the back arrow
          brings them back; on a desk they stay above the three columns. */}
      <section aria-label="Queue overview" className={cn("flex flex-col gap-2.5", sel && "hidden lg:flex")}>
        <div className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-3 lg:grid-cols-5" role="group" aria-label="Queue counts, pick one to filter">
          <Counter label="Waiting" n={c?.waiting ?? 0} on={filter === "waiting"} onClick={counter("waiting")} tone="warn" />
          <Counter label="Active" n={c?.active ?? 0} on={filter === "active"} onClick={counter("active")} />
          <Counter label="Assigned to me" n={c?.mine ?? 0} on={filter === "mine"} onClick={counter("mine")} />
          <Counter label="Unassigned" n={c?.unassigned ?? 0} on={filter === "unassigned"} onClick={counter("unassigned")} />
          <Counter label="Resolved today" n={c?.resolvedToday ?? 0} on={filter === "resolved"} onClick={counter("resolved")} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-full bg-secondary px-3.5 text-[12px] text-muted-foreground" aria-live="polite">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", online > 0 ? "bg-success" : "bg-muted-foreground/50")} aria-hidden />
            <span className="truncate">{q ? `${online} of ${q.agents.length} ${q.agents.length === 1 ? "specialist" : "specialists"} online` : "Checking who is online"}</span>
          </p>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <button type="button" aria-pressed={!!q?.away} disabled={!q || busy === "away"} onClick={toggleAway} className={q?.away ? cn(btnChip, "bg-warning/20 text-foreground hover:bg-warning/30") : btnChip + " bg-secondary text-foreground hover:bg-secondary/70"}>
              <UserRound className="h-4 w-4" aria-hidden />
              {q?.away ? "Away" : "Available"}
            </button>
            <button type="button" aria-pressed={sound} onClick={toggleSound} className={cn(btnChip, "bg-secondary text-foreground hover:bg-secondary/70")} aria-label={sound ? "Sound on for new chats, turn off" : "Sound off for new chats, turn on"}>
              {sound ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
              {sound ? "Sound on" : "Sound off"}
            </button>
            {perm === "default" && (
              <button type="button" onClick={askAlerts} className={cn(btnChip, "bg-secondary text-foreground hover:bg-secondary/70")}>
                <BellRing className="h-4 w-4" aria-hidden />
                Desktop alerts
              </button>
            )}
            {/* R1207: a real Web Push subscription for this device, so a request reaches the phone with Outlly closed. */}
            {pushSupport() !== "unsupported" && (
              <button type="button" aria-pressed={pushHere} disabled={busy === "push" || (!pushHere && !vapid)} onClick={togglePush} className={pushHere ? cn(btnChip, "bg-success/20 text-foreground hover:bg-success/30") : cn(btnChip, "bg-secondary text-foreground hover:bg-secondary/70")} title={pushHere ? "This device gets a push notification for every new support request. Tap to turn off." : "Get a push notification on this device for every new support request, even with Outlly closed."}>
                {busy === "push" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <BellRing className="h-4 w-4" aria-hidden />}
                {pushHere ? "Phone alerts on" : "Phone alerts"}
              </button>
            )}
            <button type="button" aria-pressed={reports} onClick={() => setReports((x) => !x)} className={reports ? cn(btnChip, "bg-foreground text-background hover:bg-foreground/90") : cn(btnChip, "bg-secondary text-foreground hover:bg-secondary/70")}>
              <BarChart3 className="h-4 w-4" aria-hidden />
              Reports
            </button>
          </div>
        </div>
      </section>

      {reports && (
        <div className={cn(sel && "hidden lg:block")}>
          <Reports data={q?.analytics ?? null} days={days} setDays={setDays} />
        </div>
      )}
      {paused && (
        <p role="status" className="rounded-2xl border border-border bg-card px-4 py-2.5 text-[12.5px]">
          Updates paused while nobody was at the console. Move the mouse or press a key and they pick up again.
        </p>
      )}

      <div
        className={cn(
          "grid gap-3 lg:h-[calc(100dvh-21rem)] lg:min-h-[28rem]",
          wideNow ? "lg:grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]" : "lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] xl:grid-cols-[minmax(290px,350px)_minmax(0,1fr)_minmax(280px,340px)]",
        )}
      >
        <section aria-label="Queue" className={cn("flex min-h-[26rem] flex-col overflow-hidden rounded-[22px] border border-border bg-card lg:min-h-0", sel && "hidden lg:flex", wideNow && "lg:hidden")}>
          <div className="grid grid-cols-2 gap-2 border-b border-border p-3">
            <label className={pickLabel}>
              Show
              <select value={filter} onChange={(e) => setFilter(e.target.value as QueueFilter)} className={pickField}>
                {FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </label>
            <label className={pickLabel}>
              Order
              <select value={sort} onChange={(e) => setSort(e.target.value as QueueSort)} className={pickField}>
                {SORTS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </label>
            <label className={pickLabel}>
              Category
              <select value={cat} onChange={(e) => setCat(e.target.value)} className={pickField}>
                <option value="">Any</option>
                {LIVE_CATEGORIES.map((k) => (
                  <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>
                ))}
              </select>
            </label>
            <label className={pickLabel}>
              Priority
              <select value={prio} onChange={(e) => setPrio(e.target.value)} className={pickField}>
                <option value="">Any</option>
                {LIVE_PRIORITIES.map((k) => (
                  <option key={k} value={k}>{PRIORITY_LABEL[k]}</option>
                ))}
              </select>
            </label>
          </div>
          {qErr && (
            <p role="status" className="flex items-center gap-2 border-b border-border px-4 py-2 text-[12px] text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> Can&apos;t reach the queue right now. Trying again.
            </p>
          )}
          <div className="la-scroll min-h-0 flex-1 overflow-y-auto">
            <QueueList rows={q?.items ?? []} sel={sel} onPick={pick} now={now} meId={me.id} loading={!q && !qErr} />
          </div>
        </section>

        <section aria-label="Chat" className={cn("flex h-[calc(100dvh-13.5rem)] min-h-[24rem] flex-col overflow-hidden rounded-[22px] border border-border bg-card lg:h-auto lg:min-h-0", !sel && "hidden lg:flex")}>
          {!sel ? (
            <div className="grid flex-1 place-items-center p-8 text-center">
              <div>
                <Headset className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
                <p className="mt-2 font-display text-[15px] font-semibold">Pick a chat from the queue</p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">The conversation with Pip comes with it, so you can see what they already tried.</p>
              </div>
            </div>
          ) : !d || !s ? (
            <div className="grid flex-1 place-items-center p-8 text-center">
              {dErr ? (
                <div>
                  <p className="text-[13.5px] font-semibold">{dErr}</p>
                  <button type="button" onClick={() => pick(null)} className={cn(btnQuiet, "mt-3")}>
                    Back to the queue
                  </button>
                </div>
              ) : (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Loading the chat" />
              )}
            </div>
          ) : (
            <>
              {/* Three rows, in the order a specialist reads them: who this is, what I can do, how it is filed. */}
              <header className="flex shrink-0 flex-col gap-2.5 border-b border-border p-3">
                <div className="flex items-center gap-2.5">
                  <button type="button" onClick={() => pick(null)} aria-label="Back to the queue" className={cn(btnQuiet, iconBtn, "lg:hidden")}>
                    <ArrowLeft className="h-4 w-4" aria-hidden />
                  </button>
                  <Avatar name={name} src={info?.user?.avatar} />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-display text-[15px] font-semibold leading-tight">{name}</h2>
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">
                      <span className={d.online ? "text-success-ink" : undefined}>{d.online ? "On the chat now" : "Not on the chat"}</span> <span aria-hidden>&middot;</span> {d.conversation.subject || catWord(s.category)}
                    </p>
                  </div>
                  <Pill tone={STATUS_TONE[s.status] ?? "muted"} className="shrink-0">{statusWord(s.status)}</Pill>
                  <button type="button" onClick={() => setWide((x) => !x)} aria-pressed={wide} aria-label={wide ? "Show the queue" : "Hide the queue and use the full width"} className={cn(btnQuiet, iconBtn, "hidden lg:inline-flex")}>
                    {wide ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}
                  </button>
                  <button type="button" onClick={openDrawer} aria-label="Customer details" aria-expanded={drawer} className={cn(btnQuiet, iconBtn, "xl:hidden")}>
                    <PanelRight className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                {dErr && (
                  <p role="status" className="text-[12px] text-muted-foreground">
                    {dErr}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {/* R1207: one primary action on a waiting chat. It assigns this chat to me, turns Waiting into
                      Active, and the customer's Pip chat says a specialist joined. */}
                  {s.status === "waiting" && (!s.agentId || mine) && (
                    <button type="button" onClick={accept} disabled={!!busy} className={btnPrimary}>
                      {busy === "accept" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                      Join conversation
                    </button>
                  )}
                  {open && s.agentId && !mine && (
                    <button type="button" onClick={takeover} disabled={!!busy} className={s.status === "waiting" ? btnPrimary : btnQuiet}>
                      Take over
                    </button>
                  )}
                  {canManage && (
                    <button type="button" onClick={() => void act({ action: "return" }, "Handed back to Pip. The customer was told.")} disabled={!!busy} className={btnQuiet}>
                      <RotateCcw className="h-4 w-4" aria-hidden />
                      Return to Pip
                    </button>
                  )}
                  {canManage && (
                    <button type="button" onClick={() => setConfirm(true)} disabled={!!busy} className={btnQuiet}>
                      <CheckCheck className="h-4 w-4" aria-hidden />
                      Resolve
                    </button>
                  )}
                  {!open && !d.conversation.openSessionId && (
                    <button type="button" onClick={reopen} disabled={!!busy} className={btnPrimary}>
                      <RotateCcw className="h-4 w-4" aria-hidden />
                      Reopen
                    </button>
                  )}
                  {!open && d.conversation.openSessionId && d.conversation.openSessionId !== s.id && (
                    <button type="button" onClick={() => pick(d.conversation.openSessionId)} className={btnQuiet}>
                      Open the current chat
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {canManage && q && (
                    <label className={pickLabel}>
                      {s.status === "active" ? "Transfer to" : "Assign to"}
                      <select
                        value=""
                        disabled={!!busy}
                        onChange={(e) => e.target.value && void act({ action: s.status === "active" ? "transfer" : "assign", to: e.target.value }, s.status === "active" ? "Transferred. The customer was told who joined." : "Assigned.")}
                        className={pickField}
                      >
                        <option value="">Pick a teammate</option>
                        {q.agents
                          .filter((a) => a.id !== s.agentId)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.me ? `${a.name} (me)` : a.name}
                              {a.online ? "" : a.away ? ", away" : ", offline"}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  <label className={pickLabel}>
                    Priority
                    <select value={s.priority} disabled={!!busy} onChange={(e) => setField("priority", e.target.value, "Priority updated.")} className={pickField}>
                      {LIVE_PRIORITIES.map((k) => (
                        <option key={k} value={k}>{PRIORITY_LABEL[k]}</option>
                      ))}
                    </select>
                  </label>
                  <label className={pickLabel}>
                    Category
                    <select value={s.category} disabled={!!busy} onChange={(e) => setField("category", e.target.value, "Category updated.")} className={pickField}>
                      {LIVE_CATEGORIES.map((k) => (
                        <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </header>

              {/* The messages. Day markers only appear when the date really turns, and scrolling up to read puts a
                  Latest button in reach instead of yanking the view down under the specialist's eyes. */}
              <div className="relative min-h-0 flex-1">
                {/* The live region is the scrolling box, not the list: a list that carries role="log" stops being
                    a list for a screen reader, and a box that scrolls has to be reachable by keyboard. */}
                <div ref={logRef} onScroll={onLogScroll} tabIndex={0} role="log" aria-live="polite" aria-relevant="additions" aria-label={`Messages with ${name}`} className="la-scroll h-full overflow-y-auto px-3 py-4 sm:px-4">
                  <ol className="flex flex-col gap-3">
                    {msgs.map((m, i) => (
                      <Fragment key={m.key}>
                        {(i === 0 || dayOf(m.at) !== dayOf(msgs[i - 1].at)) && (
                          <li className="mt-1 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                            <span className="h-px flex-1 bg-border" aria-hidden />
                            <time dateTime={m.at}>{dayWord(m.at)}</time>
                            <span className="h-px flex-1 bg-border" aria-hidden />
                          </li>
                        )}
                        <Line m={m} customer={name} onRetry={(x) => void send(x)} r={m.role === "agent" && (m.pending || m.failed || i === lastAgent) ? receipt(m, d.receipts) : null} />
                      </Fragment>
                    ))}
                  </ol>
                  {d.typing && (
                    <p className="mt-3 flex items-center gap-2 px-1 text-[12px] text-muted-foreground" role="status">
                      <span className="flex items-center gap-1" aria-hidden>
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground motion-reduce:animate-none" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:120ms] motion-reduce:animate-none" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:240ms] motion-reduce:animate-none" />
                      </span>
                      {name} is typing
                    </p>
                  )}
                </div>
                {!atEnd && (
                  <button type="button" onClick={toLatest} className={cn(btn, "absolute bottom-3 left-1/2 -translate-x-1/2 border border-border bg-card px-4 shadow-xl hover:bg-secondary")}>
                    <ArrowDown className="h-4 w-4" aria-hidden />
                    Latest
                  </button>
                )}
              </div>

              {/* The composer stays one line until the reply needs more, and clears the phone's home bar. */}
              <footer className="shrink-0 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                {mineActive ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void send();
                    }}
                    className="flex items-end gap-2"
                  >
                    <label htmlFor="la-reply" className="sr-only">
                      Reply to {name}
                    </label>
                    <textarea
                      id="la-reply"
                      ref={inputRef}
                      value={text}
                      onChange={(e) => onText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                      maxLength={LIVE_MAX_TEXT}
                      rows={1}
                      placeholder="Write a reply"
                      aria-describedby="la-reply-hint"
                      className={cn(field, "max-h-40 min-h-11 flex-1 resize-none py-3 leading-snug")}
                    />
                    <button type="submit" disabled={!text.trim() || sending} aria-label="Send the reply" className={cn(btnPrimary, "h-11 w-11 shrink-0 px-0")}>
                      {sending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                    </button>
                  </form>
                ) : null}
                {mineActive ? (
                  <p id="la-reply-hint" className="mt-1 hidden text-[11px] text-muted-foreground sm:block">
                    Enter sends. Shift and Enter adds a line.
                  </p>
                ) : (
                  <p className="text-[12.5px] text-muted-foreground">
                    {s.status === "waiting"
                      ? s.agentId && !mine
                        ? `Assigned to ${s.agentName}. They need to join it, or you can take it over.`
                        : "Join the conversation to reply. The customer sees that you joined."
                      : s.status === "active"
                        ? `${s.agentName || "Another specialist"} has this chat. Take it over to reply.`
                        : `This chat ended: ${statusWord(s.status).toLowerCase()}. Reopen it to write to the customer again.`}
                  </p>
                )}
                {mineActive && text.length > LIVE_MAX_TEXT - 200 && (
                  <p className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground" aria-live="polite">
                    {text.length} of {LIVE_MAX_TEXT}
                  </p>
                )}
              </footer>
            </>
          )}
        </section>

        <aside aria-label="Customer details" className="la-scroll hidden min-h-0 overflow-y-auto rounded-[22px] border border-border bg-card xl:block">
          {d ? <Details d={d} info={info} onOpen={pick} onNote={addNote} /> : <p className="p-5 text-[12.5px] text-muted-foreground">Who the customer is, their plan, platforms and past tickets show here.</p>}
        </aside>
      </div>

      {/* Under xl the same details are a dialog: full width on a phone, a card on a tablet, focus kept inside. */}
      {drawer && d && (
        <div className="fixed inset-0 z-[70] xl:hidden" role="dialog" aria-modal="true" aria-labelledby="la-drawer-t">
          <div className="absolute inset-0 bg-foreground/35 backdrop-blur-[2px]" onClick={closeDrawer} aria-hidden />
          <div ref={panelRef} tabIndex={-1} onKeyDown={trapTab} className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-border bg-card shadow-2xl outline-none sm:w-[min(94vw,26rem)] sm:rounded-l-[22px]">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
              <h2 id="la-drawer-t" className="truncate font-display text-[15px] font-semibold">
                Details
              </h2>
              <button ref={closeRef} type="button" onClick={closeDrawer} aria-label="Close details" className={cn(btnQuiet, iconBtn)}>
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="la-scroll min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
              <Details d={d} info={info} onOpen={pick} onNote={addNote} />
            </div>
          </div>
        </div>
      )}

      {confirm && d && (
        <Confirm
          title="Resolve this chat?"
          body="The customer is told it's resolved and can rate it or start a new chat. Nothing is deleted, and you can reopen it later."
          yes="Resolve"
          busy={busy === "resolve"}
          onNo={closeConfirm}
          onYes={async () => {
            await act({ action: "resolve", confirm: true }, "Resolved. The customer can rate the chat.");
            setConfirm(false);
          }}
        />
      )}
    </div>
  );
}
