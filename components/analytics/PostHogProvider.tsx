"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { appHostFor, posthogHost, posthogKey, POSTHOG_PROXY } from "@/lib/analytics/config";
import { analyticsAllowed, analyticsClient, analyticsConsent, analyticsLoading, attachAnalytics, CONSENT_EVENT, CONSENT_KEY, detachAnalytics, isAdminPath, track, whenAnalyticsReady, type AnalyticsClient } from "@/lib/analytics/track";

/*
 * 1149: PostHog, only after the visitor accepts analytics cookies (CookieConsent fires "outly:consent"), never with
 * Do Not Track on and never on /admin. Until then posthog-js isn't even downloaded, so the page is exactly as before.
 */
const readConsent = () => {
  try {
    return analyticsConsent(localStorage.getItem(CONSENT_KEY));
  } catch {
    return false;
  }
};
// Guard on window, not navigator: Node 21+ has a global navigator but no window, so a server render would crash.
const dntOn = () => navigator.doNotTrack === "1" || (window as { doNotTrack?: string }).doNotTrack === "1";
// Readable hint middleware keeps in step with the studio session; gone means signed out.
const signedIn = () => /(?:^|; )outlly_in=1(?:;|$)/.test(document.cookie);

function Tracker() {
  const path = usePathname();
  const search = useSearchParams().toString();
  const [consent, setConsent] = useState(false);
  const [client, setClient] = useState<AnalyticsClient | null>(null);
  const started = useRef(false);
  const inst = useRef<AnalyticsClient | null>(null);
  const lastView = useRef("");
  const key = posthogKey();

  useEffect(() => {
    const read = () => setConsent(readConsent());
    const onStorage = (e: StorageEvent) => e.key === CONSENT_KEY && read();
    read();
    window.addEventListener(CONSENT_EVENT, read);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CONSENT_EVENT, read);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const allowed = analyticsAllowed({ key, consent, dnt: typeof window !== "undefined" && dntOn(), path });

  useEffect(() => {
    if (!started.current) {
      if (!allowed) return;
      started.current = true;
      analyticsLoading();
      const off = whenAnalyticsReady((c) => {
        inst.current = c;
        setClient(c);
      });
      void import("posthog-js")
        .then(({ default: posthog }) => {
          posthog.init(key, {
            api_host: POSTHOG_PROXY,
            ui_host: appHostFor(posthogHost()),
            person_profiles: "identified_only",
            capture_pageview: false,
            capture_pageleave: true,
            autocapture: true,
            respect_dnt: true,
            disable_session_recording: true,
            session_recording: { maskAllInputs: true, maskTextSelector: "*" },
            disable_surveys: true,
            before_send: (e) => (isAdminPath(location.pathname) ? null : e),
            loaded: (ph) => attachAnalytics(ph),
          });
        })
        .catch(() => {
          off();
          detachAnalytics();
          started.current = false;
        });
      return;
    }
    // Consent withdrawn (or given again) after posthog-js loaded.
    const c = inst.current;
    if (!c) return;
    if (!consent && analyticsClient()) {
      c.opt_out_capturing();
      detachAnalytics();
      setClient(null);
      lastView.current = "";
    } else if (consent && !analyticsClient()) {
      c.opt_in_capturing({ captureEventName: false });
      attachAnalytics(c);
      setClient(c);
    }
  }, [allowed, consent, key]);

  useEffect(() => {
    if (!client || isAdminPath(path)) return;
    const url = search ? `${path}?${search}` : path;
    if (lastView.current === url) return;
    lastView.current = url;
    if (!signedIn() && client.get_property("$user_state") === "identified") client.reset();
    client.capture("$pageview", { $current_url: window.location.href });
    const connected = new URLSearchParams(search).get("connected");
    if (connected) track("account_connected", { platform: connected });
  }, [client, path, search]);

  return null;
}

export function PostHogProvider() {
  return (
    <Suspense fallback={null}>
      <Tracker />
    </Suspense>
  );
}
