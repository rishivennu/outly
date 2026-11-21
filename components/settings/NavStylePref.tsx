"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";
import type { NavStyle } from "@/lib/nav-config";
import { cn } from "@/lib/utils";

export const NAV_TILES: { id: NavStyle; name: string; tag: string; body: string }[] = [
  { id: "sidebar", name: "Sidebar", tag: "Original", body: "The rail on the left, collapsible, as today." },
  { id: "dock", name: "Dock", tag: "New", body: "A floating dock along the bottom, macOS style. Icons grow as you hover." },
];

/** A tiny screen with the rail on the left, or the dock along the bottom. Drawn in CSS so it follows the theme. */
export function NavPreview({ id }: { id: NavStyle }) {
  const card = "rounded-lg bg-secondary/80";
  return (
    <span aria-hidden="true" className="relative flex h-24 gap-2 overflow-hidden rounded-2xl bg-background/60 p-2.5">
      {id === "sidebar" && (
        <span className="flex w-7 flex-col items-center gap-1.5 rounded-xl bg-secondary/70 py-1.5">
          {[0, 1, 2, 3, 4].map((i) => <span key={i} className={cn("h-2 w-2 rounded-full", i === 1 ? "bg-lime" : "bg-foreground/15")} />)}
        </span>
      )}
      <span className={cn("flex flex-1 flex-col gap-1.5", id === "dock" && "pb-7")}>
        <span className="h-3 w-1/2 rounded-md bg-foreground/20" />
        <span className={cn("flex-1", card)} />
        <span className="flex h-5 gap-1.5"><span className={cn("flex-1", card)} /><span className={cn("flex-1", card)} /></span>
      </span>
      {id === "dock" && (
        <span className="absolute inset-x-0 bottom-2 flex justify-center">
          <span className="flex items-end gap-1 rounded-xl bg-secondary px-1.5 py-1 ring-1 ring-foreground/[0.08]">
            {[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className={cn("rounded-[5px]", i === 2 ? "h-3.5 w-3.5 bg-lime" : i === 1 || i === 3 ? "h-3 w-3 bg-foreground/20" : "h-2.5 w-2.5 bg-foreground/15")} />)}
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * Settings > Personalization (R1290): sidebar or dock on desktop, for this browser. The page reads the current pick
 * on the server (no flash); saving sets the cookie and refreshes, so the layout renders the other navigation.
 */
export function NavStylePref({ style, canSwitch, own }: { style: NavStyle; canSwitch: boolean; own: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [cur, setCur] = useState(style);
  const [mine, setMine] = useState(own);
  const [busy, setBusy] = useState(false);

  async function run(go: () => Promise<NavStyle>, done: (s: NavStyle) => string) {
    if (busy) return;
    const prev = cur;
    setBusy(true);
    try {
      const s = await go();
      setCur(s);
      toast(done(s), "ok");
      router.refresh();
    } catch (e) {
      setCur(prev);
      toast(e instanceof ApiError ? e.message : "Couldn't change it. Check your connection and try again.", "error");
    } finally {
      setBusy(false);
    }
  }
  const pick = (s: NavStyle) => {
    if (s === cur && mine) return;
    setCur(s);
    void run(
      async () => {
        const r = await api<{ style: NavStyle }>("/api/me/nav", { method: "POST", json: { style: s } });
        setMine(true);
        return r.style;
      },
      (v) => (v === "dock" ? "Dock is on. Your sidebar is one click away here." : "Sidebar is back."),
    );
  };
  const reset = () =>
    run(
      async () => {
        const r = await api<{ style: NavStyle }>("/api/me/nav", { method: "DELETE" });
        setMine(false);
        return r.style;
      },
      (v) => `Back to the workspace default: the ${v === "dock" ? "Dock" : "Sidebar"}.`,
    );

  return (
    <section className="glass rounded-[32px] p-6 sm:p-8" aria-labelledby="nav-style-h" data-nav-pref="">
      <h2 id="nav-style-h" className="text-2xl font-semibold tracking-tight">Navigation</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">How you move around Outlly on a computer. Phones keep the tab bar either way.</p>
      {!canSwitch && <p className="mt-3 rounded-2xl bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">Your workspace admin has set the navigation for everyone.</p>}
      <fieldset disabled={!canSwitch || busy} className="mt-5 disabled:opacity-60">
        <legend className="sr-only">Desktop navigation</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {NAV_TILES.map((t) => {
            const on = cur === t.id;
            return (
              <label key={t.id} className={cn("relative flex min-h-11 flex-col gap-3 rounded-[24px] bg-secondary/40 p-4 transition-shadow focus-within:ring-2 focus-within:ring-ring", canSwitch && "cursor-pointer", on && "ring-1 ring-inset ring-lime/50")}>
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
