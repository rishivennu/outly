"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { track } from "@/lib/analytics/track";
import type { NavIntroState, NavSource, NavStyle } from "@/lib/nav-config";
import type { NavState } from "@/lib/nav-style";
import { Sidebar } from "./Nav";

export interface NavStyleCtx {
  style: NavStyle;
  /** Whether the admin lets people pick their own. */
  canSwitch: boolean;
  /** Whether the person's own pick is in force. */
  own: boolean;
  busy: boolean;
  /** R1291: whether the "meet your new dock" card may show. Cleared the moment it is answered or the dock is picked. */
  intro: boolean;
  /** Switch now; the page follows at once and the pick is saved to the account. Rejects (ApiError) if the server says no. */
  set: (style: NavStyle, source: NavSource) => Promise<NavStyle>;
  /** Back to the workspace default. */
  reset: () => Promise<NavStyle>;
  /** The card's outcome: hides it now, remembers it on the account. Never rejects. */
  introDone: (state: NavIntroState) => Promise<void>;
}

const Ctx = createContext<NavStyleCtx | null>(null);
/** Tabs of the same person keep the same navigation (R1291). */
const CHANNEL = "outlly:nav";

/**
 * R1291: one source of truth for the desktop navigation in the browser. The server picks the first render (navFor, no
 * flash); after that the quick switcher, Settings and the intro card all read and write here, so changing it in one
 * place changes it everywhere, including the frame (NavFrame) and the page's padding, with no reload.
 */
export function NavStyleProvider({ initial, children }: { initial: NavState; children: React.ReactNode }) {
  const [style, setStyle] = useState<NavStyle>(initial.style);
  const [own, setOwn] = useState(initial.own);
  const [intro, setIntro] = useState(initial.intro);
  const [busy, setBusy] = useState(false);
  const chan = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const c = new BroadcastChannel(CHANNEL);
    c.onmessage = (e: MessageEvent<{ style?: NavStyle; own?: boolean }>) => {
      if (e.data?.style) setStyle(e.data.style);
      if (typeof e.data?.own === "boolean") setOwn(e.data.own);
    };
    chan.current = c;
    return () => { c.close(); chan.current = null; };
  }, []);
  const tell = (msg: { style: NavStyle; own: boolean }) => chan.current?.postMessage(msg);

  const set = useCallback(async (next: NavStyle, source: NavSource) => {
    const prev = style;
    const prevOwn = own;
    setStyle(next);
    setOwn(true);
    setBusy(true);
    try {
      const r = await api<{ style: NavStyle }>("/api/me/nav", { method: "POST", json: { style: next } });
      if (prev !== r.style) track("nav_style_changed", { from: prev, to: r.style, source });
      if (r.style === "dock") setIntro(false);
      setStyle(r.style);
      tell({ style: r.style, own: true });
      return r.style;
    } catch (e) {
      setStyle(prev);
      setOwn(prevOwn);
      throw e;
    } finally {
      setBusy(false);
    }
  }, [style, own]);

  const reset = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api<{ style: NavStyle }>("/api/me/nav", { method: "DELETE" });
      setStyle(r.style);
      setOwn(false);
      tell({ style: r.style, own: false });
      return r.style;
    } finally {
      setBusy(false);
    }
  }, []);

  const introDone = useCallback(async (state: NavIntroState) => {
    setIntro(false);
    try {
      await api("/api/me/nav/intro", { method: "POST", json: { state } });
    } catch {
      // The card is gone for this visit either way; the account keeps the old answer and the next visit may ask again.
    }
  }, []);

  const value = useMemo<NavStyleCtx>(() => ({ style, canSwitch: initial.canSwitch, own, busy, intro, set, reset, introDone }), [style, initial.canSwitch, own, busy, intro, set, reset, introDone]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNavStyle(): NavStyleCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useNavStyle needs NavStyleProvider");
  return c;
}

/**
 * The studio frame: the rail or the dock, then the page column. `data-nav` drives the page's bottom padding
 * (DOCK_MAIN_PAD) and the toasts' height, so a switch moves everything in one render.
 */
export function NavFrame({ children }: { children: React.ReactNode }) {
  const { style } = useNavStyle();
  return (
    <div className="flex min-h-dvh" data-nav={style}>
      <Sidebar style={style} />
      {children}
    </div>
  );
}
