"use client";
import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LayoutPanelLeft, Sparkles } from "lucide-react";
import { ADMIN_DESIGN_KEY, DESIGN_LABEL, designCookie, type AdminDesign } from "@/lib/admin/design";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { crossfade } from "./motion";

/**
 * R1304: the one way the console changes design. Writes the cookie the server layout reads (Path=/admin, a year),
 * mirrors it in localStorage, then re-renders the route inside a cross-fade so the old shell fades into the new one.
 * Nothing else changes: same page, same data, same scroll container. `useDesignSwitch` is for custom controls;
 * `DesignSwitch` is the compact header button (shows the OTHER design, the one a tap moves to).
 */
/** Where the switch was asked for, so focus can land on the same control in the new shell. */
export type SwitchOrigin = "header" | "picker";

const PICKER_CHECKED = '[data-design-picker] input[name="admin-design"]:checked';

/** The design the DOM is showing right now (the server layout stamps the root). */
const shownDesign = (): AdminDesign => (document.querySelector<HTMLElement>(".admin-root")?.dataset.adminDesign === "aurora" ? "aurora" : "classic");

/** Resolve when `ok` holds, watching the DOM, or after `timeoutMs` so nothing can hang. */
function when(ok: () => boolean, timeoutMs: number): Promise<void> {
  if (ok()) return Promise.resolve();
  return new Promise((res) => {
    const done = () => {
      mo.disconnect();
      window.clearTimeout(timer);
      res();
    };
    const mo = new MutationObserver(() => {
      if (ok()) done();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    const timer = window.setTimeout(done, timeoutMs);
  });
}

/**
 * The cross-fade gives up holding the old frame after 2.5 s (a slow refresh, dev builds), so wait for the swap
 * itself before placing focus. The page below the shell may stream in a moment after the shell, so a picker
 * origin also waits for the picker.
 */
const whenDesign = (next: AdminDesign) => when(() => shownDesign() === next, 15000);

/** After the shell swap the control that was clicked is gone; put focus on its twin, or on the page. */
async function refocus(origin: SwitchOrigin) {
  if (origin === "picker") await when(() => !!document.querySelector(PICKER_CHECKED), 3000);
  const picker = () => document.querySelector<HTMLElement>(PICKER_CHECKED);
  const header = () => document.querySelector<HTMLElement>("[data-design-switch]");
  const el = (origin === "picker" ? picker() ?? header() : header() ?? picker()) ?? document.getElementById("main");
  if (!el) return;
  if (el.tagName === "MAIN" && !el.hasAttribute("tabindex")) el.tabIndex = -1;
  el.focus({ preventScroll: true });
}

export function useDesignSwitch() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const resolve = useRef<(() => void) | null>(null);
  const settle = () => {
    resolve.current?.();
    resolve.current = null;
  };
  useEffect(() => {
    if (!pending) settle();
  }, [pending]);
  // The refresh swaps the whole shell, so this control unmounts before `pending` ever turns false: settle then too.
  useEffect(() => settle, []);
  const switchTo = (next: AdminDesign, origin: SwitchOrigin = "header") => {
    document.cookie = designCookie(next) + (location.protocol === "https:" ? "; Secure" : "");
    try {
      localStorage.setItem(ADMIN_DESIGN_KEY, next);
    } catch {}
    document.documentElement.dataset.adminDesign = next;
    return crossfade(
      () =>
        new Promise<void>((res) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            window.clearTimeout(timer);
            res();
          };
          // a refresh that never settles (offline) must not hold the old frame forever
          const timer = window.setTimeout(finish, 2500);
          resolve.current = finish;
          start(() => router.refresh());
        }),
    )
      .then(() => whenDesign(next))
      .then(() => refocus(origin));
  };
  return { switchTo, pending };
}

export function DesignSwitch({ current, className, label = false }: { current: AdminDesign; className?: string; label?: boolean }) {
  const { switchTo, pending } = useDesignSwitch();
  const next: AdminDesign = current === "aurora" ? "classic" : "aurora";
  const Icon = next === "aurora" ? Sparkles : LayoutPanelLeft;
  return (
    <Button
      type="button"
      variant="ghost"
      size={label ? "sm" : "icon"}
      onClick={() => void switchTo(next)}
      disabled={pending}
      aria-label={`Switch to the ${DESIGN_LABEL[next].name} design`}
      title={`Switch to the ${DESIGN_LABEL[next].name} design`}
      data-design-switch={next}
      className={cn("min-h-11 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring", label && "min-w-11 gap-2 px-3", className)}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label && <span>{DESIGN_LABEL[next].name}</span>}
    </Button>
  );
}
