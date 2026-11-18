"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { backgroundAlerts, idleFor, pollable } from "@/lib/client/idle";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, BellRing, Bell as BellIcon, CreditCard, Headset, LifeBuoy, Plug, Tag, Sparkles, Volume2, VolumeX, X } from "lucide-react";
import { useToast } from "@/components/shared/Toast";
import { can, type AdminRole } from "@/lib/admin/perms";
import { cn } from "@/lib/utils";
import { T } from "@/lib/motion/tokens";
import { chime, setSound, soundOn, SOUND_EVENT } from "@/lib/client/live-sound";

type Ev = { id: string; kind: string; title: string; body?: string | null; href?: string | null; createdAt: string };
const SEEN = "outly-admin-seen";
const BELL_LAST = "outly-bell-last";
const ICON: Record<string, typeof Tag> = { payment_failed: AlertTriangle, subscription_new: CreditCard, ticket_new: LifeBuoy, ticket_urgent: LifeBuoy, live_request: Headset, live_urgent: Headset, plan_changed: Tag, integration: Plug, behavior_analysis: Sparkles };
const LOUD = new Set(["payment_failed", "ticket_urgent", "ticket_new", "subscription_new", "live_request", "live_urgent"]);
const BAD = new Set(["payment_failed", "ticket_urgent", "live_urgent"]);

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

type Pos = { top: number; right: number; width: number; maxHeight: number };

/**
 * Real-time-ish alerts: polls every 30 s while someone is at the tab (no websocket server needed on Vercel), and
 * once a minute in a background tab for a live-chat specialist with desktop alerts on (R1208, backgroundAlerts).
 * New failed payments, subscriptions and tickets also pop a toast.
 *
 * 1142: the panel is portalled to <body> and fixed to the bell's own rectangle. It used to be an absolute child
 * of the sticky, backdrop-blurred top bar: a blurred ancestor stops the panel's own blur from reaching the page
 * (so it showed the page through it and looked torn loose), and the bar's stacking context capped its z-index.
 * Now it sits right under the bell, right edges aligned, moves only if the window resizes, never scrolls with the
 * page (its list scrolls inside it), and closes on a tap or click outside, Escape, a route change or the close button.
 */
export function Bell({ role }: { role: AdminRole }) {
  const [events, setEvents] = useState<Ev[]>([]);
  const [seen, setSeen] = useState<string>("");
  const [open, setOpen] = useState(false);
  const since = useRef<string | null>(null);
  const toast = useToast();
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const id = useId();
  const path = usePathname();
  // Portals need <body>, which the server render does not have.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [sound, setSoundState] = useState(true);
  useEffect(() => {
    setSoundState(soundOn());
    const on = (e: Event) => setSoundState(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener(SOUND_EVENT, on);
    return () => window.removeEventListener(SOUND_EVENT, on);
  }, []);

  const poll = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/events${since.current ? `?since=${encodeURIComponent(since.current)}` : ""}`, { cache: "no-store" });
      if (!r.ok) return;
      const j: { events: Ev[]; now: string } = await r.json();
      const first = since.current === null;
      since.current = j.now;
      if (!j.events.length) return;
      setEvents((x) => [...j.events, ...x.filter((e) => !j.events.some((n) => n.id === e.id))].slice(0, 30));
      if (!first) for (const e of j.events.filter((e) => LOUD.has(e.kind)).slice(0, 2)) toast(e.title, BAD.has(e.kind) ? "error" : "info");
      // R1184: a new Live Support request also chimes (when sound is on), wherever in the admin panel the specialist is.
      const live = first ? [] : j.events.filter((e) => e.kind === "live_request" || e.kind === "live_urgent");
      if (live.length) {
        const ids = live.map((e) => /[?&]s=([A-Za-z0-9_-]+)/.exec(e.href ?? "")?.[1] ?? e.id);
        chime(live.some((e) => e.kind === "live_urgent"), ids);
        // R1207: and a desktop alert from whichever admin page is open, when this window is not the one in front.
        // R1208: a background tab now checks too (backgroundAlerts), so this reaches someone working elsewhere.
        // Tag = the request, so the Live Support console's own alert and this one never stack up twice.
        if (typeof Notification !== "undefined" && Notification.permission === "granted" && (document.visibilityState !== "visible" || !document.hasFocus()))
          for (const [i, e] of live.slice(0, 2).entries())
            try {
              const n = new Notification(e.title, { body: e.body || "A customer is waiting for a support specialist.", tag: `live-${ids[i]}` });
              n.onclick = () => {
                window.focus();
                if (e.href) window.location.assign(e.href);
                n.close();
              };
            } catch {}
      }
    } catch {}
  }, [toast]);

  useEffect(() => {
    setSeen(localStorage.getItem(SEEN) ?? "");
    let at = Date.now();
    // R1208: every admin tab writes when it last checked, so background checks are once a minute for the whole
    // browser, not once a minute per tab (and nothing in the background while a tab someone uses is checking).
    const shared = () => {
      try {
        return Number(localStorage.getItem(BELL_LAST)) || 0;
      } catch {
        return 0;
      }
    };
    const run = () => {
      at = Date.now();
      try {
        localStorage.setItem(BELL_LAST, String(at));
      } catch {}
      void poll();
    };
    run();
    // 1150: every 30 s while someone is at the tab. R1208: otherwise once a minute, for desktop alerts only.
    const live = can(role, "live");
    const perm = () => (typeof Notification === "undefined" ? null : Notification.permission);
    const t = setInterval(() => (pollable() || backgroundAlerts(live, Date.now() - Math.max(at, shared()), idleFor(), perm())) && run(), 30_000);
    // Coming back to the tab checks at once, unless this tab checked in the last 10 s (quick tab flipping).
    const v = () => document.visibilityState === "visible" && Date.now() - at > 10_000 && run();
    document.addEventListener("visibilitychange", v);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", v);
    };
  }, [poll, role]);

  // Anchor: right edge lined up with the bell, 8px under it. On a phone it spans the screen less 12px each side and
  // stops 12px above the bottom (and the home indicator), so it is never clipped and its list scrolls inside.
  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const width = Math.min(380, vw - 24);
    const right = Math.max(12, Math.min(vw - r.right, vw - width - 12));
    const top = Math.round(r.bottom + 8);
    setPos({ top, right: Math.round(right), width, maxHeight: Math.max(220, vh - top - 12) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    // The bar is sticky, so scrolling never moves the bell; this only matters if something above it changes height.
    window.addEventListener("scroll", place, { passive: true });
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus({ preventScroll: true });
    const close = (back: boolean) => {
      setOpen(false);
      if (back) btn.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(true);
    // pointerdown covers mouse, pen and touch (mousedown fires late or not at all after a tap on some phones).
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

  const unread = events.filter((e) => e.createdAt > seen).length;
  const markSeen = () => {
    const top = events[0]?.createdAt ?? new Date().toISOString();
    localStorage.setItem(SEEN, top);
    setSeen(top);
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) setTimeout(markSeen, 1200);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? `${id}-panel` : undefined}
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        title="Notifications"
        className={cn("relative grid h-11 w-11 place-items-center rounded-full hover:bg-secondary", open && "bg-secondary")}
      >
        {unread ? <BellRing className="bell-ring h-[19px] w-[19px]" /> : <BellIcon className="h-[19px] w-[19px]" />}
        {unread > 0 && <span className="absolute right-[5px] top-[5px] grid h-[17px] min-w-[17px] place-items-center rounded-full bg-lime px-[3px] text-[10px] font-bold leading-none text-[hsl(var(--lime-foreground))] ring-2 ring-background">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && pos && (
              <motion.div
                ref={panel}
                id={`${id}-panel`}
                key="admin-bell"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={T.menu}
                style={{ top: pos.top, right: pos.right, width: pos.width, maxHeight: Math.min(560, pos.maxHeight) }}
                data-lenis-prevent
                tabIndex={-1}
                role="dialog"
                aria-labelledby={`${id}-h`}
                className="glass-strong fixed z-[70] flex origin-top-right flex-col overflow-hidden rounded-[22px] shadow-2xl outline-none"
              >
                <div className="flex items-center justify-between gap-2 border-b border-border/60 py-1.5 pl-4 pr-1.5">
                  <div className="min-w-0">
                    <h2 id={`${id}-h`} className="font-display text-[15px] font-semibold">Alerts</h2>
                    <p className="text-[11.5px] text-muted-foreground">Live · checks every 15 s</p>
                  </div>
                  {can(role, "live") && (
                    <button type="button" aria-pressed={sound} aria-label={sound ? "Live chat sound on. Turn it off" : "Live chat sound off. Turn it on"} title={sound ? "Sound on for new live chats" : "Sound off for new live chats"} onClick={() => setSound(!sound)} className="ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
                      {sound ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
                    </button>
                  )}
                  <button type="button" aria-label="Close notifications" onClick={() => { setOpen(false); btn.current?.focus(); }} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
                  {events.length === 0 && <li className="px-3 py-8 text-center text-[13px] text-muted-foreground">Nothing yet. Failed payments, new subscriptions, tickets and live chat requests show up here{role === "support" ? " (tickets for your role)" : ""}.</li>}
                  {events.map((e) => {
                    const Icon = ICON[e.kind] ?? BellIcon;
                    const bad = BAD.has(e.kind);
                    const inner = (
                      <span className={cn("flex gap-3 rounded-2xl px-2.5 py-2.5 transition-colors hover:bg-foreground/[0.05]", e.createdAt > seen && "bg-lime/[0.07]")}>
                        <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full", bad ? "bg-destructive/15 text-destructive" : "bg-lime/15 text-lime-ink")}>
                          <Icon className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] font-medium leading-snug">{e.title}</span>
                          {e.body && <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{e.body}</span>}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{ago(e.createdAt)}</span>
                      </span>
                    );
                    return <li key={e.id}>{e.href ? <Link href={e.href} onClick={() => setOpen(false)}>{inner}</Link> : inner}</li>;
                  })}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
