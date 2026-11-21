"use client";
import { Check } from "lucide-react";
import { useToast } from "@/components/shared/Toast";
import { useNavStyle } from "@/components/shell/NavStyleProvider";
import { ApiError } from "@/lib/client/api";
import type { NavStyle } from "@/lib/nav-config";
import { cn } from "@/lib/utils";

export const NAV_TILES: { id: NavStyle; name: string; tag: string; body: string }[] = [
  { id: "sidebar", name: "Sidebar", tag: "Original", body: "The rail on the left, collapsible, as today." },
  { id: "dock", name: "Dock", tag: "New", body: "A floating dock along the bottom, macOS style. Icons grow as you hover." },
];

/**
 * A tiny screen with the rail on the left, or the dock along the bottom. Drawn in CSS so it follows the theme.
 * `compact` (R1291): the 88x56 thumbnail in the quick switcher.
 */
export function NavPreview({ id, compact = false }: { id: NavStyle; compact?: boolean }) {
  const card = "rounded-lg bg-secondary/80";
  const c = compact;
  return (
    <span aria-hidden="true" className={cn("relative flex overflow-hidden bg-background/60", c ? "h-14 w-[88px] shrink-0 gap-1 rounded-xl p-1.5" : "h-24 gap-2 rounded-2xl p-2.5")}>
      {id === "sidebar" && (
        <span className={cn("flex flex-col items-center bg-secondary/70", c ? "w-4 gap-1 rounded-md py-1" : "w-7 gap-1.5 rounded-xl py-1.5")}>
          {[0, 1, 2, 3, 4].map((i) => <span key={i} className={cn("rounded-full", c ? "h-1 w-1" : "h-2 w-2", i === 1 ? "bg-lime" : "bg-foreground/15")} />)}
        </span>
      )}
      <span className={cn("flex flex-1 flex-col", c ? "gap-1" : "gap-1.5", id === "dock" && (c ? "pb-3.5" : "pb-7"))}>
        <span className={cn("w-1/2 bg-foreground/20", c ? "h-1.5 rounded-sm" : "h-3 rounded-md")} />
        <span className={cn("flex-1", card, c && "rounded-md")} />
        <span className={cn("flex", c ? "h-2.5 gap-1" : "h-5 gap-1.5")}><span className={cn("flex-1", card, c && "rounded-sm")} /><span className={cn("flex-1", card, c && "rounded-sm")} /></span>
      </span>
      {id === "dock" && (
        <span className={cn("absolute inset-x-0 flex justify-center", c ? "bottom-1" : "bottom-2")}>
          <span className={cn("flex items-end bg-secondary ring-1 ring-foreground/[0.08]", c ? "gap-0.5 rounded-md px-1 py-0.5" : "gap-1 rounded-xl px-1.5 py-1")}>
            {[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className={cn(c ? "rounded-[2px]" : "rounded-[5px]", i === 2 ? (c ? "h-2 w-2 bg-lime" : "h-3.5 w-3.5 bg-lime") : i === 1 || i === 3 ? (c ? "h-1.5 w-1.5 bg-foreground/20" : "h-3 w-3 bg-foreground/20") : c ? "h-1 w-1 bg-foreground/15" : "h-2.5 w-2.5 bg-foreground/15")} />)}
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * Settings > Personalization (R1290): sidebar or dock on desktop. R1291: reads and writes the shared NavStyleProvider,
 * so the frame changes live under the card (no refresh) and stays in step with the quick switcher in the rail and dock.
 */
export function NavStylePref() {
  const toast = useToast();
  const { style: cur, own: mine, busy, canSwitch, set, reset: resetNav } = useNavStyle();

  async function run(go: () => Promise<NavStyle>, done: (s: NavStyle) => string) {
    if (busy) return;
    try {
      toast(done(await go()), "ok");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't change it. Check your connection and try again.", "error");
    }
  }
  const pick = (s: NavStyle) => {
    if (s === cur && mine) return;
    void run(
      () => set(s, "settings"),
      (v) => (v === "dock" ? "Dock is on. Your sidebar is one click away here." : "Sidebar is back."),
    );
  };
  const reset = () => run(resetNav, (v) => `Back to the workspace default: the ${v === "dock" ? "Dock" : "Sidebar"}.`);

  return (
    <section id="navigation" className="glass scroll-mt-24 rounded-[32px] p-6 sm:p-8" aria-labelledby="nav-style-h" data-nav-pref="">
      <h2 id="nav-style-h" className="text-2xl font-semibold tracking-tight">Navigation</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">How you move around Outlly on a computer. Phones keep the tab bar either way.</p>
      {!canSwitch && <p className="mt-3 rounded-2xl bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">Your workspace admin has set the navigation for everyone.</p>}
      <fieldset disabled={!canSwitch || busy} className="mt-5 disabled:opacity-60">
        <legend className="sr-only">Desktop navigation</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {NAV_TILES.map((t) => {
            const on = cur === t.id;
            return (
              <label key={t.id} className={cn("relative flex min-h-11 flex-col gap-3 rounded-[24px] p-4 transition-[background-color,box-shadow] focus-within:ring-2 focus-within:ring-ring", canSwitch && "cursor-pointer", on ? "bg-secondary ring-1 ring-inset ring-lime/50" : "ring-1 ring-inset ring-foreground/[0.08] hover:bg-foreground/[0.06]")}>
                <input type="radio" name="nav-style" value={t.id} checked={on} onChange={() => pick(t.id)} className="sr-only" />
                <span className="flex items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold">{t.name}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-medium", t.id === "dock" ? "bg-lime text-lime-foreground" : "bg-foreground/[0.08] text-muted-foreground")}>{t.tag}</span>
                  </span>
                  {on && (
                    <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-foreground">
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      {busy ? "Saving" : "On"}
                    </span>
                  )}
                </span>
                <NavPreview id={t.id} />
                <span className="text-[13.5px] text-muted-foreground">{t.body}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {canSwitch && mine && (
        <button type="button" onClick={reset} disabled={busy} className="mt-4 inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-muted-foreground underline-offset-4 outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
          Use the workspace default
        </button>
      )}
    </section>
  );
}
