"use client";
import { useCallback, useState, useSyncExternalStore } from "react";
import { useUserKey } from "@/components/shell/UserContext";

/**
 * 1114: a tab's own choices (a range, a filter, a week) kept while you visit other tabs, so coming back finds it as
 * you left it. Per browser tab (sessionStorage), per account (keyed by a hash of who is signed in), and for half an
 * hour: a tab left alone longer opens on its defaults. Restored only when the page is created in the browser (a
 * tab switch); a full load renders the server's defaults, so the HTML and hydration always agree.
 */
const KEEP = 30 * 60_000;
type Store = Pick<Storage, "getItem" | "setItem">;
const store = (): Store | null => {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

export const tabKey = (who: string | null, section: string) => (who ? `outlly:tab:${who}:${section}` : null);

export function readTab(key: string, now = Date.now(), s: Store | null = store()): unknown {
  try {
    const o = JSON.parse(s?.getItem(key) ?? "null") as { at?: unknown; v?: unknown } | null;
    if (!o || typeof o.at !== "number" || now - o.at > KEEP || now < o.at - 60_000) return null;
    return o.v ?? null;
  } catch {
    return null;
  }
}

export function writeTab(key: string, v: unknown, now = Date.now(), s: Store | null = store()) {
  try {
    s?.setItem(key, JSON.stringify({ at: now, v }));
  } catch {
    /* private mode or full: the tab just opens on its defaults */
  }
}

const never = () => () => {};
/** False while hydrating server HTML, true for anything React creates in the browser (a client-side navigation). */
export const useClientRender = () => useSyncExternalStore(never, () => true, () => false);

/**
 * Pages save their state from an effect, so the first save is the state the page opened on. That one is never
 * written (nor an echo of it, until something else was): a full load opens on the server's defaults and must not wipe
 * what the tab held. Only a change is kept. `restored`: the page opened on what it held, so the first save is written
 * (it restarts the half hour, so a tab you keep coming back to keeps its state). Takes the JSON of each save; true =
 * write it.
 */
export function changeGate(restored = false) {
  let opened: string | null | undefined = restored ? null : undefined;
  return (json: string) => {
    if (opened === undefined) {
      opened = json;
      return false;
    }
    if (opened !== null) {
      if (json === opened) return false;
      opened = null;
    }
    return true;
  };
}

/** `saved`: what this tab held last time (validated by `valid`), read once when the page is created. `save` keeps it. */
export function useTabMemory<T>(section: string, valid: (v: unknown) => T | null) {
  const who = useUserKey();
  const client = useClientRender();
  const key = tabKey(who, section);
  const [saved] = useState<T | null>(() => (client && key ? valid(readTab(key)) : null));
  // One gate per key: when the account or profile changes, the state on screen (the last one's) is not written under
  // the new key until it changes.
  const [gates] = useState(() => new Map<string, ReturnType<typeof changeGate>>());
  const save = useCallback(
    (v: T) => {
      if (!key) return;
      let g = gates.get(key);
      if (!g) gates.set(key, (g = changeGate(gates.size === 0 && saved !== null)));
      if (g(JSON.stringify(v))) writeTab(key, v);
    },
    [key, gates, saved],
  );
  return { saved, save };
}
