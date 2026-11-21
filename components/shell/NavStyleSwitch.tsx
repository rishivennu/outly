"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, SlidersHorizontal } from "lucide-react";
import { DockItem } from "@/components/ui/motion/Dock";
import { NAV_TILES, NavPreview } from "@/components/settings/NavStylePref";
import { useToast } from "@/components/shared/Toast";
import { ApiError } from "@/lib/client/api";
import { track } from "@/lib/analytics/track";
import type { NavStyle } from "@/lib/nav-config";
import { PANEL } from "@/lib/motion/fluid";
import { usePanelPresence } from "@/lib/motion/useFluid";
import { cn } from "@/lib/utils";
import { useNavStyle } from "./NavStyleProvider";

/** How long the popover stays after a pick, so the solid highlight is seen moving before it closes. */
const SETTLE_MS = 220;
/** Picking the other style swaps the rail for the dock (or back) and unmounts this trigger; the new one takes focus. */
let refocus = false;

/**
 * R1291: the one-tap sidebar/dock picker, in the rail's footer and in the dock. Reads and writes the shared
 * NavStyleProvider, so the frame switches at once; Settings > Personalization stays the long form.
 */
export function NavStyleSwitch({ variant, wrap }: { variant: "rail" | "dock"; wrap?: (trigger: React.ReactElement) => React.ReactNode }) {
  const { style, canSwitch, busy, set } = useNavStyle();
  const toast = useToast();
  const path = usePathname();
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const slot = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const shown = usePanelPresence(open, panel, PANEL.rise, variant === "rail" ? "0% 100%" : "50% 100%");

  const trigger = useCallback((): HTMLElement | null => btn.current ?? slot.current?.querySelector("button") ?? null, []);

  useEffect(() => {
    if (!refocus) return;
    refocus = false;
    trigger()?.focus();
  }, [trigger]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const close = useCallback((back: boolean) => {
    window.clearTimeout(timer.current);
    setOpen(false);
    if (back) trigger()?.focus();
  }, [trigger]);

  const place = useCallback(() => {
    const r = trigger()?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(300, window.innerWidth - 24);
    if (variant === "rail") {
      setPos({ left: Math.min(r.right + 12, window.innerWidth - w - 12), bottom: Math.max(12, window.innerHeight - r.bottom), width: w });
    } else {
      // Over the dock, centred on the trigger and kept on screen; never covering the dock itself.
      const left = Math.max(12, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 12));
      const dock = trigger()?.closest(".dock")?.getBoundingClientRect();
      const top = dock && dock.height > 0 ? dock.top : r.top;
      setPos({ left, bottom: window.innerHeight - top + 12, width: w });
    }
  }, [trigger, variant]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    panel.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(true);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger()?.contains(t)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, close, trigger]);

  useEffect(() => setOpen(false), [path]);

  if (!canSwitch) return null;

  const toggle = () => {
    if (!open) track("nav_switcher_opened", { style });
    setOpen((v) => !v);
  };

  async function pick(next: NavStyle) {
    if (busy) return;
    if (next === style) return close(true);
    refocus = true;
    try {
      await set(next, "switcher");
      timer.current = window.setTimeout(() => close(true), SETTLE_MS);
    } catch (e) {
      refocus = false;
      toast(e instanceof ApiError ? e.message : "Couldn't change it. Check your connection and try again.", "error");
    }
  }

  const onRadioKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const radios = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const at = radios.indexOf(document.activeElement as HTMLButtonElement);
    const to = radios[(at + step + radios.length) % radios.length];
    radios.forEach((r) => (r.tabIndex = r === to ? 0 : -1));
    to?.focus();
  };

  const aria = { "aria-haspopup": "dialog" as const, "aria-expanded": open, "aria-controls": open ? `${id}-panel` : undefined };
  const railBtn = (
    <button ref={btn} type="button" onClick={toggle} aria-label="Change dock style" {...aria} className="rail-row">
      <span className="rail-ic">
        <SlidersHorizontal size={20} strokeWidth={1.8} aria-hidden="true" />
      </span>
      <span className="rail-label">Dock style</span>
    </button>
  );

  return (
    <>
      {variant === "rail" ? (
        wrap ? wrap(railBtn) : railBtn
      ) : (
        <span ref={slot} className="contents">
          <DockItem label="Change dock style" onClick={toggle} attrs={aria}>
            <SlidersHorizontal strokeWidth={1.8} />
          </DockItem>
        </span>
      )}
      {shown &&
        createPortal(
          <div ref={panel} id={`${id}-panel`} role="dialog" aria-label="Dock style" style={pos} data-nav-switch="" className="glass-strong fixed z-[70] w-[300px] rounded-[20px] p-2 shadow-2xl outline-none">
            <p className="px-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Dock style</p>
            <div role="radiogroup" aria-label="Dock style" onKeyDown={onRadioKey} className="mt-1.5 flex flex-col gap-1">
              {NAV_TILES.map((t) => {
                const on = style === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    tabIndex={on ? 0 : -1}
                    onClick={() => void pick(t.id)}
                    className={cn(
                      "flex h-[72px] w-full items-center gap-3 rounded-2xl px-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                      on ? "bg-secondary ring-1 ring-lime/60" : "hover:bg-foreground/[0.06]",
                    )}
                  >
                    <NavPreview id={t.id} compact />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-[14px] font-semibold text-foreground">{t.name}</span>
                        <span className={cn("rounded-full px-1.5 py-px text-[10.5px] font-medium", t.id === "dock" ? "bg-lime text-lime-foreground" : "bg-foreground/[0.08] text-muted-foreground")}>{t.tag}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">{t.body}</span>
                    </span>
                    {on && <Check className="h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 flex justify-end px-1">
              <Link href="/settings?tab=personalization#navigation" className="inline-flex h-11 items-center rounded-xl px-2.5 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                More in Settings
              </Link>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
