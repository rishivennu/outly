"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useUser } from "@/components/shell/UserContext";
import { Spotlight, findTarget, type Stop } from "./Spotlight";
import { GUIDES, guideKey, guidesOffKey, presentStops, tourState } from "./guides";
import { tourKey } from "./Tour";

/*
 * First-visit tips: the first time someone opens a studio page, a short spotlight walks its main parts.
 * Once per page per person (stored on this device). It waits its turn: after the welcome tour, the
 * cookie choice and the privacy notice, and never on top of another dialog (it waits for it to close). "Turn off tips" stops them
 * all; replaying the tour from Settings brings them back. The command palette can show them again.
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
    let seen = true;
    try {
      seen = !!localStorage.getItem(guidesOffKey(user.id)) || !!localStorage.getItem(guideKey(guide.page, user.id)) || !localStorage.getItem(tourKey(user.id));
    } catch {
      return; // storage blocked: never nag on every visit
    }
    // The welcome tour ran on this page this visit: that was enough for one sitting.
    if (seen || tourState.ranOn === path) return;
    let tries = 0;
    // Give the page a moment to render its content, then wait for a quiet moment: another popup
    // (the update notice, a dialog the person opened) may take a while. Leaving the page stops the wait.
    const t = window.setInterval(() => {
      if (++tries < 2 || busy()) return;
      window.clearInterval(t);
      open();
    }, 1000);
    return () => window.clearInterval(t);
  }, [guide, path, user.id, open]);

  useEffect(() => {
    // Asked for from the command palette: wait for the palette (or any other dialog) to close first,
    // so two modal cards never stack. Give up after about 3 s.
    let t = 0;
    const again = () => {
      window.clearInterval(t);
      let n = 0;
      t = window.setInterval(() => {
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
  }, [open]);

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
