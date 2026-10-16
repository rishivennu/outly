"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, Bell, CircleAlert, Info, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";

type Notice = { id: string; kind: string; tone: "danger" | "warn" | "info"; title: string; body: string; href: string | null; action: string | null; read: boolean; createdAt: string };
const ICON = { danger: AlertTriangle, warn: CircleAlert, info: Info } as const;
const TONE = { danger: "text-destructive", warn: "text-warning", info: "text-muted-foreground" } as const;

const when = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));
};

/**
 * Notices bell: failed posts, accounts that need a reconnect, tokens about to end, goal nudges.
 * The list resolves itself on the server once a problem is fixed. Non-modal panel: Escape or a click
 * outside closes it and focus goes back to the bell.
 */
/* The sidebar and the mobile top bar each mount a bell (one is hidden by CSS). Share one request between them. */
type NoticeList = { notices: Notice[]; unread: number };
let inflight: { at: number; p: Promise<NoticeList> } | null = null;
function fetchNotices(): Promise<NoticeList> {
  if (inflight && Date.now() - inflight.at < 2000) return inflight.p;
  const p = api<NoticeList>("/api/notices");
  inflight = { at: Date.now(), p };
  p.catch(() => (inflight = null));
  return p;
}

export function NoticesBell({ placement = "side", className }: { placement?: "side" | "below"; className?: string }) {
  const path = usePathname();
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notice[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [pos, setPos] = useState<React.CSSProperties>({});

  const load = useCallback(() => {
    fetchNotices()
      .then((r) => {
        setItems(r.notices);
        setUnread(r.unread);
      })
      .catch(() => setItems((x) => x ?? []));
  }, []);

  useEffect(() => {
    load();
  }, [load, path]);
  useEffect(() => {
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [load]);

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(360, window.innerWidth - 24);
    if (placement === "side") setPos({ left: Math.min(r.right + 12, window.innerWidth - w - 12), bottom: Math.max(12, window.innerHeight - r.bottom), width: w });
    else setPos({ top: r.bottom + 8, right: 12, width: w });
  }, [placement]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    panel.current?.focus();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const close = (back = true) => {
      setOpen(false);
      if (back) btn.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  useEffect(() => setOpen(false), [path]);

  async function markRead(ids: string[] | "all") {
    setItems((x) => x?.map((n) => (ids === "all" || ids.includes(n.id) ? { ...n, read: true } : n)) ?? null);
    setUnread((u) => (ids === "all" ? 0 : Math.max(0, u - ids.length)));
    await api("/api/notices", { method: "PATCH", json: ids === "all" ? { all: true } : { ids } }).catch(() => load());
  }

  const label = unread ? `Notices, ${unread} unread` : "Notices";
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        title="Notices"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn("relative grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground", open && "bg-secondary text-foreground", className)}
      >
        <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
        {unread > 0 && (
          <span aria-hidden="true" className="absolute right-1.5 top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-destructive px-1 text-[10.5px] font-bold leading-none text-destructive-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={`${id}-panel`}
            role="dialog"
            aria-labelledby={`${id}-h`}
            tabIndex={-1}
            style={pos}
            data-lenis-prevent
            className="notice-panel glass-strong fixed z-[70] flex max-h-[min(520px,calc(100dvh-24px))] flex-col overflow-hidden rounded-[24px] shadow-2xl outline-none"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2">
              <h2 id={`${id}-h`} className="text-[15px] font-semibold">Notices</h2>
              <div className="flex items-center">
                {unread > 0 && (
                  <button type="button" onClick={() => markRead("all")} className="h-11 rounded-full px-3 text-[13px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
                    Mark all read
                  </button>
                )}
                <button type="button" aria-label="Close notices" onClick={() => { setOpen(false); btn.current?.focus(); }} className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="min-h-0 overflow-y-auto overscroll-contain p-2">
              {items === null ? (
                <p className="p-4 text-sm text-muted-foreground">Loading</p>
              ) : items.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Nothing needs you right now. If a post fails or an account signs out, you'll see it here first.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {items.map((n) => {
                    const Icon = ICON[n.tone] ?? Info;
                    const inner = (
                      <>
                        <Icon className={cn("mt-0.5 h-[18px] w-[18px] shrink-0", TONE[n.tone])} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className={cn("block text-[14px] leading-snug", n.read ? "font-medium text-muted-foreground" : "font-semibold")}>
                            {!n.read && <span className="sr-only">Unread. </span>}
                            {n.title}
                          </span>
                          <span className="mt-0.5 block text-[13px] text-muted-foreground">{n.body}</span>
                          <span className="mt-1 flex items-center gap-2 text-[12px] text-muted-foreground">
                            {n.action && n.href && <span className="font-medium text-foreground underline-offset-2 group-hover:underline">{n.action}</span>}
                            <span>{when(n.createdAt)}</span>
                          </span>
                        </span>
                        {!n.read && <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-destructive" />}
                      </>
                    );
                    return (
                      <li key={n.id}>
                        {n.href ? (
                          <Link href={n.href} onClick={() => !n.read && markRead([n.id])} className="group flex min-h-[44px] gap-3 rounded-2xl p-3 hover:bg-secondary">
                            {inner}
                          </Link>
                        ) : (
                          <button type="button" onClick={() => !n.read && markRead([n.id])} className="group flex min-h-[44px] w-full gap-3 rounded-2xl p-3 text-left hover:bg-secondary">
                            {inner}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
