"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SettingsCategory = { id: string; label: string; blurb: string; icon: LucideIcon; content: React.ReactNode };

/** Old deep links (/settings#team, emails with #referral) still land in the right place. */
const HASH_TO_TAB: Record<string, string> = { team: "team", referral: "referral", "your-data": "privacy", security: "security", billing: "billing" };

type Dirty = { set: (id: string, on: boolean) => void; open: (id: string) => void };
const DirtyCtx = createContext<Dirty>({ set: () => {}, open: () => {} });
/** Jump to another category from inside a panel ("Change it in Profile"). */
export function useOpenCategory() {
  return useContext(DirtyCtx).open;
}
/** A panel with a form says when it has changes nobody saved yet: its menu item gets a dot, leaving asks first. */
export function useUnsaved(id: string, on: boolean) {
  const { set } = useContext(DirtyCtx);
  useEffect(() => {
    set(id, on);
    return () => set(id, false);
  }, [id, on, set]);
}

/**
 * Settings, one category at a time (1053). Every panel stays mounted and only the active one shows, so a
 * half-typed name or a two-step setup in progress survives a trip to another category. The category lives in
 * ?tab= (replaceState, no server round trip), so a refresh or a shared link opens the same one, and the
 * browser's back button still leaves the page as before.
 */
export function SettingsShell({ title, intro, categories, initialTab }: { title: string; intro: string; categories: SettingsCategory[]; initialTab?: string }) {
  // Keyed on the ids, not the array: the parent builds a fresh list every render.
  const idKey = categories.map((c) => c.id).join(",");
  const ids = useMemo(() => idKey.split(","), [idKey]);
  // ?tab= is known on the server, so the right panel is in the first paint (no flash of Profile).
  const [active, setActive] = useState(initialTab && ids.includes(initialTab) ? initialTab : ids[0]!);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const headRefs = useRef<Record<string, HTMLHeadingElement | null>>({});

  // The URL decides after mount (the server can't know the hash), then stays in step with it.
  useEffect(() => {
    const read = () => {
      const sp = new URLSearchParams(window.location.search);
      const tab = sp.get("tab") ?? HASH_TO_TAB[window.location.hash.slice(1)] ?? null;
      if (tab && ids.includes(tab)) setActive(tab);
    };
    read();
    window.addEventListener("popstate", read);
    window.addEventListener("hashchange", read);
    return () => {
      window.removeEventListener("popstate", read);
      window.removeEventListener("hashchange", read);
    };
  }, [ids]);

  // A soft navigation to /settings?tab=x re-renders with a new initialTab but fires no popstate.
  useEffect(() => {
    if (initialTab && ids.includes(initialTab)) setActive(initialTab);
  }, [initialTab, ids]);

  const anyDirty = Object.values(dirty).some(Boolean);
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  const go = useCallback((id: string, focus: boolean) => {
    setActive(id);
    setMenuOpen(false);
    const u = new URL(window.location.href);
    u.searchParams.set("tab", id);
    u.hash = "";
    window.history.replaceState(window.history.state, "", u);
    if (focus) requestAnimationFrame(() => headRefs.current[id]?.focus({ preventScroll: false }));
    else if (window.scrollY > 200) window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, []);

  const dirtyApi = useMemo<Dirty>(() => ({ set: (id, on) => setDirty((d) => (!!d[id] === on ? d : { ...d, [id]: on })), open: (id) => go(id, true) }), [go]);

  const current = categories.find((c) => c.id === active) ?? categories[0]!;
  const item = (c: SettingsCategory, mobile: boolean) => {
    const on = c.id === active;
    const Ico = c.icon;
    return (
      <li key={c.id}>
        <button
          type="button"
          data-settings-nav={c.id}
          onClick={() => go(c.id, mobile && !window.matchMedia("(min-width: 1024px)").matches)}
          aria-current={on ? "page" : undefined}
          className={cn(
            "group flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[14px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
            on ? "bg-lime/15 text-foreground" : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
          )}
        >
          <Ico className={cn("h-[18px] w-[18px] shrink-0", on ? "text-lime-ink" : "opacity-80 group-hover:opacity-100")} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{c.label}</span>
          {dirty[c.id] && (
            <span className="h-2 w-2 shrink-0 rounded-full bg-warning" title="Unsaved changes">
              <span className="sr-only">(unsaved changes)</span>
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <DirtyCtx.Provider value={dirtyApi}>
      <div className="px-5 pb-16 pt-8 sm:px-10 lg:pt-14">
        <p className="eyebrow mb-3">Settings</p>
        <h1 className="display max-w-3xl text-[clamp(2.4rem,5.5vw,4.2rem)]">{title}</h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">{intro}</p>

        <div className="mt-8 grid max-w-6xl gap-6 lg:mt-10 lg:grid-cols-[14.5rem_minmax(0,1fr)] lg:gap-10">
          <div id="settings-nav" className="min-w-0">
            {/* Phones: one row that opens the list, so the content starts near the top. */}
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-controls="settings-menu"
              className="flex min-h-12 w-full items-center gap-3 rounded-2xl bg-secondary/60 px-4 text-left hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring lg:hidden"
            >
              <current.icon className="h-[18px] w-[18px] shrink-0 text-lime-ink" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Category</span>
                <span className="block truncate text-[15px] font-semibold">{current.label}</span>
              </span>
              {anyDirty && <span className="h-2 w-2 rounded-full bg-warning" aria-hidden="true" />}
              <ChevronDown className={cn("h-5 w-5 shrink-0 transition-transform", menuOpen && "rotate-180")} aria-hidden="true" />
            </button>
            <nav aria-label="Settings categories" className={cn("lg:sticky lg:top-6", menuOpen ? "mt-2 block" : "hidden lg:block")}>
              <ul id="settings-menu" className="space-y-0.5 rounded-2xl bg-secondary/40 p-1.5 hairline lg:bg-transparent lg:p-0 lg:shadow-none lg:[box-shadow:none]">
                {categories.map((c) => item(c, true))}
              </ul>
            </nav>
          </div>

          <div className="min-w-0">
            {categories.map((c) => (
              <section key={c.id} id={`panel-${c.id}`} hidden={c.id !== active} aria-labelledby={`panel-${c.id}-h`} className="settings-panel">
                <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <h2 id={`panel-${c.id}-h`} ref={(el) => { headRefs.current[c.id] = el; }} tabIndex={-1} className="text-[1.6rem] font-semibold tracking-tight outline-none">
                      {c.label}
                    </h2>
                    <p className="mt-1 max-w-xl text-sm text-muted-foreground">{c.blurb}</p>
                  </div>
                  {dirty[c.id] && (
                    <span role="status" className="inline-flex h-7 items-center gap-1.5 rounded-full bg-warning/15 px-3 text-[12.5px] font-semibold pill-ink-warn">
                      <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" /> Unsaved changes
                    </span>
                  )}
                </header>
                <div className="flex flex-col gap-4">{c.content}</div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </DirtyCtx.Provider>
  );
}

/** Rarely needed settings fold away: native <details>, so it works with keyboard and screen readers as is. */
export function Disclosure({ title, hint, children, defaultOpen = false }: { title: string; hint?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group rounded-[24px] hairline [&_summary::-webkit-details-marker]:hidden" open={defaultOpen || undefined}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-[24px] px-5 py-3 transition-colors hover:bg-secondary/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{title}</span>
          {hint && <span className="block text-[13px] text-muted-foreground">{hint}</span>}
        </span>
        <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="px-5 pb-5 pt-1">{children}</div>
    </details>
  );
}
