"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, BarChart3, BellRing, Check, CheckCheck, Clock, Headset, Loader2, PanelRight, RotateCcw, Send, StickyNote, UserRound, Volume2, VolumeX, X } from "lucide-react";
import { useToast } from "@/components/shared/Toast";
import { Pill, ago, fmtDate, type Tone } from "@/components/admin/ui";
import { chime, setSound, soundOn, SOUND_EVENT } from "@/lib/client/live-sound";
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
 */

type QueueData = Awaited<ReturnType<typeof queue>> & { away: boolean; analytics: Awaited<ReturnType<typeof analytics>> | null };
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
        "flex min-h-11 min-w-[7.5rem] flex-1 flex-col items-start rounded-2xl border px-3.5 py-2 text-left transition-colors",
        on ? "border-foreground/40 bg-foreground/[0.06]" : "border-border hover:bg-secondary/60",
        ring,
      )}
    >
      <span className="text-[11.5px] font-medium text-muted-foreground">{label}</span>
      <span className={cn("font-display text-[1.35rem] font-semibold tabular-nums leading-tight", tone === "warn" && n > 0 && "pill-ink-warn")}>{n}</span>
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
    <div className="rounded-2xl border border-border px-3.5 py-2.5">
      <p className="text-[11.5px] text-muted-foreground">{label}</p>
      <p className="font-display text-[1.2rem] font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Reports({ data, days, setDays }: { data: QueueData["analytics"]; days: number; setDays: (d: number) => void }) {
  return (
    <section aria-labelledby="la-reports" className="rounded-[22px] border border-border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="la-reports" className="font-display text-[15px] font-semibold">
          Reports
        </h2>
        <div className="flex gap-1" role="group" aria-label="Period">
          {[1, 7, 30, 90].map((d) => (
            <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={cn(btn, "min-h-11 px-3 text-[12px]", days === d ? "bg-foreground text-background" : "bg-secondary")}>
              {d === 1 ? "Today" : `${d} days`}
            </button>
          ))}
        </div>
      </div>
      {!data ? (
        <p className="text-[13px] text-muted-foreground">Loading</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
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
            <div className="mt-3 overflow-x-auto">
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

/** One message. Text is always rendered as text (React escapes it), never as HTML. */
function Line({ m, r, customer, onRetry }: { m: Msg; r: Receipt | null; customer: string; onRetry: (m: Msg) => void }) {
  if (m.role === "system")
    return (
      <li className="my-1 flex justify-center">
        <span className="rounded-full bg-secondary px-3 py-1 text-center text-[11.5px] text-muted-foreground">
          {staffSysLine(m.text) ?? m.text} <span aria-hidden>·</span> <time dateTime={m.at}>{time(m.at)}</time>
        </span>
      </li>
    );
  const ours = m.role !== "user";
  const who = m.role === "user" ? customer : m.role === "pip" ? "Pip" : m.author || "Specialist";
  const R = r ? RECEIPT[r] : null;
  return (
    <li className={cn("flex flex-col gap-1", ours ? "items-end" : "items-start")}>
      <span className="px-1 text-[11px] text-muted-foreground">
        {who} <span aria-hidden>·</span> <time dateTime={m.at}>{time(m.at)}</time>
      </span>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap break-words rounded-[18px] px-3.5 py-2 text-[13.5px] leading-relaxed",
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

const H3 = "mb-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";
type Info = NonNullable<Detail["customer"]>;

/** Who the customer is, this chat's facts, staff notes and the assignment history. */
function Details({ d, info, onOpen, onNote }: { d: Detail; info: Info | null; onOpen: (id: string) => void; onNote: (body: string) => Promise<boolean> }) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const s = d.session;
  const u = info?.user;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim() || saving) return;
    setSaving(true);
    if (await onNote(note)) setNote("");
    setSaving(false);
  };
  return (
    <div className="flex flex-col gap-5 p-4">
      <section aria-labelledby="la-who">
        <h3 id="la-who" className={H3}>Customer</h3>
        {u ? (
          <div className="flex items-start gap-3">
            <Avatar name={u.name || u.email} src={u.avatar} size={44} />
            <div className="min-w-0 text-[12.5px]">
              <p className="truncate text-[14px] font-semibold">{u.name || "No name"}</p>
              <p className="truncate text-muted-foreground">{u.email}</p>
              <p className="mt-1 text-muted-foreground">
                Joined {fmtDate(u.createdAt)}
                {u.country ? `, ${u.country}` : ""}
              </p>
              <p className="text-muted-foreground">
                {d.online ? "On the chat now" : `Last seen ${ago(u.lastSeenAt)}`}, {u.timezone}
              </p>
              <Link href={`/admin/users?q=${encodeURIComponent(u.email)}`} className={cn("mt-1 inline-flex min-h-11 items-center font-semibold underline-offset-2 hover:underline", ring)}>
                Open in Users
              </Link>
            </div>
          </div>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">{info ? "This account was removed." : "Loading"}</p>
        )}
      </section>

      {info && (
        <section aria-labelledby="la-plan">
          <h3 id="la-plan" className={H3}>Plan and platforms</h3>
          <p className="text-[12.5px]">
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
            <ul className="mt-2 flex flex-col gap-1 text-[12.5px]">
              {info.accounts.map((a, i) => (
                <li key={`${a.platform}-${i}`} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    <span className="font-medium capitalize">{a.platform}</span> <span className="text-muted-foreground">@{a.username}</span>
                  </span>
                  <Pill tone={a.status === "connected" || a.status === "active" ? "ok" : "warn"}>{a.status}</Pill>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[12.5px] text-muted-foreground">No platforms connected</p>
          )}
        </section>
      )}

      <section aria-labelledby="la-this">
        <h3 id="la-this" className={H3}>This chat</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
          <dt className="text-muted-foreground">Asked</dt>
          <dd>{fmtDate(s.requestedAt, true)}</dd>
          <dt className="text-muted-foreground">Waited</dt>
          <dd>{fmtDuration(s.waitMs)}</dd>
          <dt className="text-muted-foreground">First reply</dt>
          <dd>{s.firstResponseAt ? fmtDuration(new Date(s.firstResponseAt).getTime() - new Date(s.acceptedAt ?? s.requestedAt).getTime()) : "None yet"}</dd>
          {s.endedAt && (
            <>
              <dt className="text-muted-foreground">Ended</dt>
              <dd>
                {fmtDate(s.endedAt, true)}
                {s.endedBy ? ` by ${s.endedBy}` : ""}
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Rating</dt>
          <dd>{s.csat == null ? "Not rated" : s.csat > 0 ? "Helpful" : "Not helpful"}</dd>
          <dt className="text-muted-foreground">Conversation</dt>
          <dd>{d.conversation.ref}</dd>
          {s.ticketId && (
            <>
              <dt className="text-muted-foreground">Ticket</dt>
              <dd>
                <Link href={`/admin/tickets/${s.ticketId}`} className={cn("font-semibold underline-offset-2 hover:underline", ring)}>
                  Open the ticket
                </Link>
              </dd>
            </>
          )}
        </dl>
      </section>

      <section aria-labelledby="la-notes">
        <h3 id="la-notes" className={H3}>
          <StickyNote className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
          Notes, only your team sees these
        </h3>
        {d.notes.length > 0 && (
          <ul className="mb-2 flex flex-col gap-2">
            {d.notes.map((n) => (
              <li key={n.id} className="rounded-2xl bg-warning/10 px-3 py-2 text-[12.5px]">
                <p className="whitespace-pre-wrap break-words">{n.body}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {n.author}, {ago(n.at)}
                </p>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={save} className="flex flex-col gap-2">
          <label htmlFor="la-note" className="sr-only">
            New note
          </label>
          <textarea id="la-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} rows={2} placeholder="Add a note for your team" className={cn(field, "min-h-[4.5rem] py-2")} />
          <button type="submit" disabled={!note.trim() || saving} className={cn(btnQuiet, "self-end")}>
            {saving && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
            Add note
          </button>
        </form>
      </section>

      {info && (info.tickets.length > 0 || info.past.length > 0) && (
        <section aria-labelledby="la-past">
          <h3 id="la-past" className={H3}>Before this</h3>
          <ul className="flex flex-col gap-1 text-[12.5px]">
            {info.tickets.map((t) => (
              <li key={t.id}>
                <Link href={`/admin/tickets/${t.id}`} className={cn("flex min-h-11 items-center gap-2 rounded-xl px-2 hover:bg-secondary/60", ring)}>
                  <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">{t.ref}</span>
                  <span className="min-w-0 flex-1 truncate">{t.subject}</span>
                  <Pill tone={t.status === "resolved" ? "muted" : "warn"}>{t.status}</Pill>
                </Link>
              </li>
            ))}
            {info.past.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onOpen(p.id)} className={cn("flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left hover:bg-secondary/60", ring)}>
                  <span className="min-w-0 flex-1 truncate">
                    Live chat, {catWord(p.category).toLowerCase()}, {fmtDate(p.requestedAt)}
                    {p.agentName ? ` with ${p.agentName}` : ""}
                  </span>
                  <Pill tone={STATUS_TONE[p.status] ?? "muted"}>{statusWord(p.status)}</Pill>
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
                <span>
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
  const [sel, setSel] = useState<string | null>(null);
  const [d, setD] = useState<Detail | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [dErr, setDErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [text, setText] = useState("");

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
    const on = (e: Event) => setSoundUi(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener(SOUND_EVENT, on);
    return () => window.removeEventListener(SOUND_EVENT, on);
  }, []);

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
            body: r ? `${r.customer?.name || "A customer"}: ${r.preview || catWord(r.category)}` : `${data.counts.waiting} waiting in Live Assist`,
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

  // Keep the newest message in view unless the specialist scrolled up to read.
  useEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs, d?.typing]);

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

  useEffect(() => {
    if (!drawer) return;
    closeRef.current?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [drawer]);

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
    const r = await act({ action: "accept" }, "You have this chat. The customer can see you joined.");
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
    try {
      const r = await call<{ message: WireMsg; duplicate: boolean }>(`/api/admin/live-assist/${encodeURIComponent(id)}`, { action: "send", text: body, cid });
      if (selRef.current === id) setMsgs((m) => mergeLive(m, [r.message], toMsg));
    } catch (e) {
      if (selRef.current === id) setMsgs((m) => m.map((x) => (x.cid === cid ? { ...x, pending: false, failed: true } : x)));
      toast(e instanceof Error ? e.message : "Not sent. Try again.", "error");
      if (e instanceof CallError && (e.status === 403 || e.status === 409)) void refresh();
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-1 flex-wrap gap-2" role="group" aria-label="Queue counts, pick one to filter">
          <Counter label="Waiting" n={c?.waiting ?? 0} on={filter === "waiting"} onClick={counter("waiting")} tone="warn" />
          <Counter label="Active" n={c?.active ?? 0} on={filter === "active"} onClick={counter("active")} />
          <Counter label="Assigned to me" n={c?.mine ?? 0} on={filter === "mine"} onClick={counter("mine")} />
          <Counter label="Unassigned" n={c?.unassigned ?? 0} on={filter === "unassigned"} onClick={counter("unassigned")} />
          <Counter label="Resolved today" n={c?.resolvedToday ?? 0} on={filter === "resolved"} onClick={counter("resolved")} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-muted-foreground" aria-live="polite">
            {q ? `${online} of ${q.agents.length} ${q.agents.length === 1 ? "specialist" : "specialists"} online` : ""}
          </span>
          <button type="button" aria-pressed={!!q?.away} disabled={!q || busy === "away"} onClick={toggleAway} className={q?.away ? cn(btn, "bg-warning/20 text-foreground") : btnQuiet}>
            <UserRound className="h-4 w-4" aria-hidden />
            {q?.away ? "Away" : "Available"}
          </button>
          <button type="button" aria-pressed={sound} onClick={toggleSound} className={btnQuiet} aria-label={sound ? "Sound on for new chats, turn off" : "Sound off for new chats, turn on"}>
            {sound ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
            {sound ? "Sound on" : "Sound off"}
          </button>
          {perm === "default" && (
            <button type="button" onClick={askAlerts} className={btnQuiet}>
              <BellRing className="h-4 w-4" aria-hidden />
              Desktop alerts
            </button>
          )}
          <button type="button" aria-pressed={reports} onClick={() => setReports((x) => !x)} className={reports ? btnPrimary : btnQuiet}>
            <BarChart3 className="h-4 w-4" aria-hidden />
            Reports
          </button>
        </div>
      </div>

      {reports && <Reports data={q?.analytics ?? null} days={days} setDays={setDays} />}
      {paused && (
        <p role="status" className="rounded-2xl border border-border px-4 py-2.5 text-[12.5px]">
          Updates paused while nobody was at the console. Move the mouse or press a key and they pick up again.
        </p>
      )}

      <div className="grid gap-3 lg:h-[calc(100dvh-15rem)] lg:min-h-[560px] lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] xl:grid-cols-[minmax(290px,350px)_minmax(0,1fr)_minmax(270px,320px)]">
        <section aria-label="Queue" className={cn("flex min-h-[420px] flex-col overflow-hidden rounded-[22px] border border-border bg-card lg:min-h-0", sel && "hidden lg:flex")}>
          <div className="grid grid-cols-2 gap-2 border-b border-border p-3">
            <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
              Show
              <select value={filter} onChange={(e) => setFilter(e.target.value as QueueFilter)} className={field}>
                {FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
              Order
              <select value={sort} onChange={(e) => setSort(e.target.value as QueueSort)} className={field}>
                {SORTS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
              Category
              <select value={cat} onChange={(e) => setCat(e.target.value)} className={field}>
                <option value="">Any</option>
                {LIVE_CATEGORIES.map((k) => (
                  <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
              Priority
              <select value={prio} onChange={(e) => setPrio(e.target.value)} className={field}>
                <option value="">Any</option>
                {LIVE_PRIORITIES.map((k) => (
                  <option key={k} value={k}>{PRIORITY_LABEL[k]}</option>
                ))}
              </select>
            </label>
          </div>
          {qErr && (
            <p role="status" className="flex items-center gap-2 border-b border-border px-4 py-2 text-[12px] text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Can't reach the queue right now. Trying again.
            </p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <QueueList rows={q?.items ?? []} sel={sel} onPick={pick} now={now} meId={me.id} loading={!q && !qErr} />
          </div>
        </section>

        <section aria-label="Chat" className={cn("flex h-[calc(100dvh-9rem)] min-h-[440px] flex-col overflow-hidden rounded-[22px] border border-border bg-card lg:h-auto lg:min-h-0", !sel && "hidden lg:flex")}>
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
              <header className="flex flex-col gap-2 border-b border-border p-3">
                <div className="flex items-center gap-2.5">
                  <button type="button" onClick={() => pick(null)} aria-label="Back to the queue" className={cn(btnQuiet, "w-11 px-0 lg:hidden")}>
                    <ArrowLeft className="h-4 w-4" aria-hidden />
                  </button>
                  <Avatar name={name} src={info?.user?.avatar} />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-display text-[15px] font-semibold">{name}</h2>
                    <p className="truncate text-[11.5px] text-muted-foreground">
                      {d.online ? "On the chat now" : "Not on the chat"} <span aria-hidden>·</span> {d.conversation.subject || catWord(s.category)}
                    </p>
                  </div>
                  <Pill tone={STATUS_TONE[s.status] ?? "muted"}>{statusWord(s.status)}</Pill>
                  <button type="button" onClick={() => setDrawer(true)} aria-label="Customer details" aria-expanded={drawer} className={cn(btnQuiet, "w-11 px-0 xl:hidden")}>
                    <PanelRight className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                {dErr && (
                  <p role="status" className="text-[12px] text-muted-foreground">
                    {dErr}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {s.status === "waiting" && (!s.agentId || mine) && (
                    <button type="button" onClick={accept} disabled={!!busy} className={btnPrimary}>
                      {busy === "accept" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                      Accept
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
                    <button type="button" onClick={reopen} disabled={!!busy} className={btnQuiet}>
                      Reopen
                    </button>
                  )}
                  {!open && d.conversation.openSessionId && d.conversation.openSessionId !== s.id && (
                    <button type="button" onClick={() => pick(d.conversation.openSessionId)} className={btnQuiet}>
                      Open the current chat
                    </button>
                  )}
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    {canManage && q && (
                      <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                        {s.status === "active" ? "Transfer to" : "Assign to"}
                        <select
                          value=""
                          disabled={!!busy}
                          onChange={(e) => e.target.value && void act({ action: s.status === "active" ? "transfer" : "assign", to: e.target.value }, s.status === "active" ? "Transferred. The customer was told who joined." : "Assigned.")}
                          className={field}
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
                    <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                      Priority
                      <select value={s.priority} disabled={!!busy} onChange={(e) => setField("priority", e.target.value, "Priority updated.")} className={field}>
                        {LIVE_PRIORITIES.map((k) => (
                          <option key={k} value={k}>{PRIORITY_LABEL[k]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                      Category
                      <select value={s.category} disabled={!!busy} onChange={(e) => setField("category", e.target.value, "Category updated.")} className={field}>
                        {LIVE_CATEGORIES.map((k) => (
                          <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>
                        ))}
                      </select>
                    </label>
                  </span>
                </div>
              </header>

              <div ref={logRef} onScroll={(e) => {
                const el = e.currentTarget;
                stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              }} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <ol role="log" aria-live="polite" aria-relevant="additions" aria-label="Messages" className="flex flex-col gap-3">
                  {msgs.map((m, i) => (
                    <Line key={m.key} m={m} customer={name} onRetry={(x) => void send(x)} r={m.role === "agent" && (m.pending || m.failed || i === lastAgent) ? receipt(m, d.receipts) : null} />
                  ))}
                </ol>
                {d.typing && (
                  <p className="mt-3 text-[12px] text-muted-foreground" role="status">
                    {name} is typing
                  </p>
                )}
              </div>

              <footer className="border-t border-border p-3">
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
                      rows={2}
                      placeholder="Write a reply. Enter sends, Shift and Enter adds a line."
                      className={cn(field, "max-h-40 min-h-[3rem] flex-1 resize-none py-2.5")}
                    />
                    <button type="submit" disabled={!text.trim()} aria-label="Send" className={cn(btnPrimary, "w-11 px-0")}>
                      <Send className="h-4 w-4" aria-hidden />
                    </button>
                  </form>
                ) : (
                  <p className="text-[12.5px] text-muted-foreground">
                    {s.status === "waiting"
                      ? s.agentId && !mine
                        ? `Assigned to ${s.agentName}. They need to accept it, or you can take it over.`
                        : "Accept the chat to reply. The customer sees that you joined."
                      : s.status === "active"
                        ? `${s.agentName || "Another specialist"} has this chat. Take it over to reply.`
                        : `This chat ended: ${statusWord(s.status).toLowerCase()}. Reopen it to write to the customer again.`}
                  </p>
                )}
                {mineActive && text.length > LIVE_MAX_TEXT - 200 && (
                  <p className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">
                    {text.length} of {LIVE_MAX_TEXT}
                  </p>
                )}
              </footer>
            </>
          )}
        </section>

        <aside aria-label="Customer details" className="hidden min-h-0 overflow-y-auto rounded-[22px] border border-border bg-card xl:block">
          {d ? <Details d={d} info={info} onOpen={pick} onNote={addNote} /> : <p className="p-5 text-[12.5px] text-muted-foreground">Who the customer is, their plan, platforms and past tickets show here.</p>}
        </aside>
      </div>

      {drawer && d && (
        <div className="fixed inset-0 z-[70] xl:hidden" role="dialog" aria-modal="true" aria-labelledby="la-drawer-t">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} aria-hidden />
          <div className="glass-strong absolute inset-y-0 right-0 flex w-[min(92vw,380px)] flex-col overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between border-b border-border p-3">
              <h2 id="la-drawer-t" className="font-display text-[15px] font-semibold">
                Details
              </h2>
              <button ref={closeRef} type="button" onClick={() => setDrawer(false)} aria-label="Close details" className={cn(btnQuiet, "w-11 px-0")}>
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <Details d={d} info={info} onOpen={pick} onNote={addNote} />
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
