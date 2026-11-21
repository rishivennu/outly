"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { FX, T as T_ } from "@/lib/motion/tokens";
import { RESTORED_TEXT, UndoRing, isUndoAction, restoredHoldMs } from "@/components/ui/easy/UndoToast";
import { countdown, TOAST_EVENT, toastDuration, type ToastCloseReason, type ToastOptions, type ToastRequest, type ToastTone } from "@/lib/client/toast-core";

// `acted`: the action already ran (Undo runs at once, while its toast shows "Restored." for a moment).
type T = { id: number; text: string; tone: ToastTone; acted?: boolean } & ToastOptions;
type Push = (text: string, tone?: ToastTone, opts?: ToastOptions) => number;
const Ctx = createContext<Push>(() => 0);
const DismissCtx = createContext<(id: number) => void>(() => {});

const MAX = 4;
const ring = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))]";

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  // The live list, so close() can call onClose exactly once, outside the state updater (which may run twice).
  const live = useRef(new Map<number, T>());
  const close = useCallback((id: number, reason: ToastCloseReason) => {
    const t = live.current.get(id);
    if (!t) return;
    live.current.delete(id);
    setItems((x) => x.filter((i) => i.id !== id));
    const why = t.acted ? "action" : reason;
    if (why === "action" && !t.acted) t.action?.onClick();
    t.onClose?.(why);
  }, []);
  const act = useCallback((id: number) => {
    const t = live.current.get(id);
    if (!t || t.acted) return;
    t.acted = true;
    t.action?.onClick();
  }, []);
  const push = useCallback<Push>((text, tone = "ok", opts = {}) => {
    const id = Date.now() + Math.random();
    const t = { id, text, tone, ...opts };
    live.current.set(id, t);
    setItems((x) => [...x, t]);
    // Errors wait to be dismissed, so a burst of them can't pile up: the oldest go once there are more than four.
    for (const old of [...live.current.keys()].slice(0, Math.max(0, live.current.size - MAX))) close(old, "timeout");
    return id;
  }, [close]);
  const dismiss = useCallback((id: number) => close(id, "dismiss"), [close]);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<ToastRequest>).detail;
      if (!d || d.shown) return;
      d.shown = true;
      push(d.text, d.tone, d.opts);
    };
    window.addEventListener(TOAST_EVENT, on);
    return () => window.removeEventListener(TOAST_EVENT, on);
  }, [push]);
  return (
    <Ctx.Provider value={push}>
      <DismissCtx.Provider value={dismiss}>
        {children}
        <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-[var(--sa-float)] z-[90] flex flex-col items-center gap-2 pl-[max(1rem,var(--sa-l))] pr-[max(1rem,var(--sa-r))] lg:bottom-8">
          <AnimatePresence>
            {items.map((t) => (
              <ToastItem key={t.id} t={t} onClose={(r) => close(t.id, r)} onAct={() => act(t.id)} />
            ))}
          </AnimatePresence>
        </div>
      </DismissCtx.Provider>
    </Ctx.Provider>
  );
}

function ToastItem({ t, onClose, onAct }: { t: T; onClose: (r: ToastCloseReason) => void; onAct: () => void }) {
  const timer = useRef<ReturnType<typeof countdown> | null>(null);
  const done = useRef(onClose);
  done.current = onClose;
  const calm = !!useReducedMotion();
  const undo = isUndoAction(t.action);
  const total = toastDuration(t.tone, t.duration);
  const [restored, setRestored] = useState(false);
  const leave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(leave.current), []);
  const left = useCallback(() => timer.current?.left() ?? total ?? 0, [total]);
  // R1288: Undo puts the item back at once; the toast says so for a moment, then goes.
  const pressUndo = () => {
    if (restored) return;
    timer.current?.cancel();
    setRestored(true);
    onAct();
    leave.current = setTimeout(() => done.current("action"), restoredHoldMs(calm));
  };
  // Hover and focus both hold the clock; it runs again only when neither is on the toast.
  const holds = useRef({ hover: false, focus: false });
  useEffect(() => {
    const ms = toastDuration(t.tone, t.duration);
    if (ms === null) return;
    const c = countdown(ms, () => done.current("timeout"));
    timer.current = c;
    return () => c.cancel();
  }, [t.tone, t.duration]);
  const hold = (k: "hover" | "focus", on: boolean) => {
    holds.current[k] = on;
    if (holds.current.hover || holds.current.focus) timer.current?.pause();
    else timer.current?.resume();
  };
  return (
    <motion.div
      layout
      transition={T_.nav}
      {...FX.toast}
      role={t.tone === "error" ? "alert" : undefined}
      onPointerEnter={() => hold("hover", true)}
      onPointerLeave={() => hold("hover", false)}
      onFocus={() => hold("focus", true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && hold("focus", false)}
      className="lg-glass pointer-events-auto flex max-w-[min(520px,calc(100vw-2rem))] items-center gap-2.5 rounded-3xl py-0.5 pl-4 pr-0.5 text-sm font-medium"
    >
      {undo && total !== null ? <UndoRing total={total} left={left} restored={restored} /> : t.tone === "ok" ? <Check className="h-4 w-4 shrink-0 text-success" aria-hidden /> : t.tone === "error" ? <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden /> : <Info className="h-4 w-4 shrink-0 text-accent" aria-hidden />}
      {undo ? (
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={restored ? "r" : "t"} initial={calm ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={calm ? undefined : { opacity: 0, y: -6 }} transition={{ duration: 0.18 }} className="min-w-0 flex-1 py-2.5">
            {restored ? RESTORED_TEXT : t.text}
          </motion.span>
        </AnimatePresence>
      ) : (
        <span className="min-w-0 flex-1 py-2.5">{t.text}</span>
      )}
      {t.action && !restored && (
        <button type="button" onClick={undo ? pressUndo : () => onClose("action")} className={`h-11 shrink-0 rounded-full px-3 font-semibold text-foreground underline decoration-foreground/40 underline-offset-4 transition-colors hover:bg-foreground/10 hover:decoration-foreground ${ring}`}>
          {t.action.label}
        </button>
      )}
      <button type="button" aria-label="Dismiss" onClick={() => onClose("dismiss")} className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground ${ring}`}>
        <X className="h-4 w-4" aria-hidden />
      </button>
    </motion.div>
  );
}

/** toast(text, tone?, { action, duration, onClose }?) returns the toast's id. */
export const useToast = () => useContext(Ctx);
/** Closes a toast by id, as if its Dismiss button was pressed. */
export const useToastDismiss = () => useContext(DismissCtx);
