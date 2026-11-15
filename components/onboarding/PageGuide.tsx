"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useUser } from "@/components/shell/UserContext";
import { Spotlight, findTarget, type Stop } from "./Spotlight";
import { CALM_TICKS, GUIDES, calmTick, guideKey, guidesOffKey, guideReady, presentStops, tourState } from "./guides";
import { tourKey } from "./Tour";

/*
 * First-visit tips: the first time someone opens a studio page, a short spotlight walks its main parts.
 * Once per page per person (stored on this device). It waits its turn: after the welcome tour, the
 * cookie choice and the privacy notice, and never on top of another dialog (it waits for it to close). "Turn off tips" stops them
 * all; replaying the tour from Settings brings them back. The command palette can show them again.
 * Phase 4: a page can hold its tips until something is on screen (Create: the first upload has landed).
 */

const OPEN = "outly:guide-open";
export function showPageTips() {
  window.dispatchEvent(new Event(OPEN));
}

function busy() {
  return !!(
    tourState.open ||
    document.hidden ||
    document.documentElement.dataset.onboarding ||
    document.querySelector('[role="dialog"], [aria-labelledby="cc-title"]')
  );
}

export function PageGuide() {
  const user = useUser();
  const path = usePathname();
  const guide = GUIDES[path];
  const [stops, setStops] = useState<Stop[] | null>(null);

  const ready = useCallback(() => !!guide && guideReady(guide, (s) => !!document.querySelector(s)), [guide]);

  const open = useCallback(() => {
    if (!guide) return;
    setStops(presentStops(guide, (t) => !!findTarget(t)));
    window.dispatchEvent(new Event("outly:guide"));
  }, [guide]);

  // Whenever the tips go away (finished, the page changed, the tour took over), tell the popups
  // that were waiting (Pip, the update notice) that the moment is free again.
  const shown = useRef(false);
  useEffect(() => {
    if (stops) shown.current = true;
    else if (shown.current) {
      shown.current = false;
      window.dispatchEvent(new Event("outly:guide-closed"));
    }
  }, [stops]);
  useEffect(
    () => () => {
      if (shown.current) window.dispatchEvent(new Event("outly:guide-closed"));
    },
    [],
  );

  // Leaving the page closes its tips without counting them as seen.
  useEffect(() => () => setStops(null), [path]);

  useEffect(() => {
    if (!guide) return;
    // Phase 2: the guided setup links here with ?tips=1 to show this page's tips now, seen before or not.
    const q = new URLSearchParams(location.search);
    const asked = q.get("tips") === "1";
    if (asked) {
      q.delete("tips");
      history.replaceState(history.state, "", location.pathname + (q.toString() ? `?${q}` : ""));
    }
    let seen = true;
    try {
      seen = !!localStorage.getItem(guidesOffKey(user.id)) || !!localStorage.getItem(guideKey(guide.page, user.id)) || !localStorage.getItem(tourKey(user.id));
    } catch {
      if (!asked) return; // storage blocked: never nag on every visit
    }
    // The welcome tour ran on this page this visit: that was enough for one sitting.
    if (!asked && (seen || tourState.ranOn === path)) return;
    let calm = 0;
    // Give the page a moment to render its content, then wait for two quiet seconds in a row: another popup
    // (the update notice, a dialog the person opened) may take a while. Leaving the page stops the wait.
    const t = window.setInterval(() => {
      calm = calmTick(calm, busy(), ready());
      if (calm < CALM_TICKS) return;
      window.clearInterval(t);
      open();
    }, 1000);
    return () => window.clearInterval(t);
  }, [guide, path, user.id, open, ready]);

  useEffect(() => {
    // Asked for from the command palette: wait for the palette (or any other dialog) to close first,
    // so two modal cards never stack. Give up after about 3 s, unless the page is still getting ready
    // (Create before the first upload): then they show once it is.
    let t = 0;
    const again = () => {
      window.clearInterval(t);
      let n = 0;
      t = window.setInterval(() => {
        if (!ready()) return;
        if (++n > 15) return window.clearInterval(t);
        if (busy()) return;
        window.clearInterval(t);
        open();
      }, 200);
    };
    const stop = () => setStops(null);
    window.addEventListener(OPEN, again);
    window.addEventListener("outly:tour", stop);
    return () => {
      window.clearInterval(t);
      window.removeEventListener(OPEN, again);
      window.removeEventListener("outly:tour", stop);
    };
  }, [open, ready]);

  if (!guide || !stops) return null;
  const finish = (how: "done" | "skip") => {
    try {
      localStorage.setItem(guideKey(guide.page, user.id), new Date().toISOString());
      if (how === "skip") localStorage.setItem(guidesOffKey(user.id), new Date().toISOString());
    } catch {
      /* fine: they may see it once more */
    }
    setStops(null); // the effect above announces outly:guide-closed
  };
  return <Spotlight key={path} label={`${guide.name} tips`} kicker={`${guide.name} tips`} stops={stops} skipLabel="Turn off tips" onClose={finish} />;
}
