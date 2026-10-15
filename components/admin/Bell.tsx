"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, BellRing, Bell as BellIcon, CreditCard, LifeBuoy, Plug, Tag, Sparkles } from "lucide-react";
import { useToast } from "@/components/shared/Toast";
import type { AdminRole } from "@/lib/admin/perms";
import { cn } from "@/lib/utils";

type Ev = { id: string; kind: string; title: string; body?: string | null; href?: string | null; createdAt: string };
const SEEN = "outly-admin-seen";
const ICON: Record<string, typeof Tag> = { payment_failed: AlertTriangle, subscription_new: CreditCard, ticket_new: LifeBuoy, ticket_urgent: LifeBuoy, plan_changed: Tag, integration: Plug, behavior_analysis: Sparkles };
const LOUD = new Set(["payment_failed", "ticket_urgent", "ticket_new", "subscription_new"]);

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * Real-time-ish alerts: polls every 15 s while the tab is visible (no websocket server needed on
 * Vercel). New failed payments, subscriptions and tickets also pop a toast.
 */
export function Bell({ role }: { role: AdminRole }) {
  const [events, setEvents] = useState<Ev[]>([]);
  const [seen, setSeen] = useState<string>("");
  const [open, setOpen] = useState(false);
  const since = useRef<string | null>(null);
  const toast = useToast();
  const box = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const r = await fetch(`/api/admin/events${since.current ? `?since=${encodeURIComponent(since.current)}` : ""}`, { cache: "no-store" });
      if (!r.ok) return;
      const j: { events: Ev[]; now: string } = await r.json();
      const first = since.current === null;
      since.current = j.now;
      if (!j.events.length) return;
      setEvents((x) => [...j.events, ...x.filter((e) => !j.events.some((n) => n.id === e.id))].slice(0, 30));
      if (!first) for (const e of j.events.filter((e) => LOUD.has(e.kind)).slice(0, 2)) toast(e.title, e.kind === "payment_failed" || e.kind === "ticket_urgent" ? "error" : "info");
    } catch {}
  }, [toast]);

  useEffect(() => {
    setSeen(localStorage.getItem(SEEN) ?? "");
    poll();
    const t = setInterval(poll, 15_000);
    const v = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", v);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", v);
    };
  }, [poll]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const unread = events.filter((e) => e.createdAt > seen).length;
  const markSeen = () => {
    const top = events[0]?.createdAt ?? new Date().toISOString();
    localStorage.setItem(SEEN, top);
    setSeen(top);
  };

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) setTimeout(markSeen, 1200);
        }}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        className="relative grid h-11 w-11 place-items-center rounded-full hover:bg-secondary"
      >
        {unread ? <BellRing className="bell-ring h-[19px] w-[19px]" /> : <BellIcon className="h-[19px] w-[19px]" />}
        {unread > 0 && <span className="absolute right-1.5 top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-lime px-1 text-[10.5px] font-bold text-[hsl(var(--lime-foreground))]">{unread > 9 ? "9+" : unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 500, damping: 36 }}
            className="glass-strong absolute right-0 top-12 z-50 w-[min(380px,calc(100vw-2rem))] origin-top-right overflow-hidden rounded-[22px]"
            role="region"
            aria-label="Notifications"
          >
            <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
              <p className="font-display text-[15px] font-semibold">Alerts</p>
              <p className="text-[11.5px] text-muted-foreground">Live · checks every 15 s</p>
            </div>
            <ul className="max-h-[60dvh] overflow-y-auto px-2 pb-2">
              {events.length === 0 && <li className="px-3 py-8 text-center text-[13px] text-muted-foreground">Nothing yet. Failed payments, new subscriptions and tickets show up here{role === "support" ? " (tickets for your role)" : ""}.</li>}
              {events.map((e) => {
                const Icon = ICON[e.kind] ?? BellIcon;
                const bad = e.kind === "payment_failed" || e.kind === "ticket_urgent";
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
      </AnimatePresence>
    </div>
  );
}
