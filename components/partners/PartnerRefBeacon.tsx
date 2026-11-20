"use client";
import { useEffect } from "react";
import { CONSENT_EVENT, CONSENT_KEY } from "@/lib/analytics/track";
import { isPartnerCode } from "@/lib/partners/attribution-core";

const SENT = "ol_pref_sent";

function consented() {
  try {
    const c = JSON.parse(localStorage.getItem(CONSENT_KEY) ?? "null");
    if (c?.v !== 1) return null;
    return c.analytics === true || c.marketing === true;
  } catch {
    return null;
  }
}

/**
 * R1282: outlly.com/?ref=<partnerCode>. Reports the visit once per tab, and only after the visitor allowed analytics
 * or marketing cookies (waits for the banner when they have not answered yet). The server decides whether the code
 * is a partner's; a Refer & Earn code is ignored there.
 */
export function PartnerRefBeacon() {
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const code = q.get("ref")?.trim().toLowerCase();
    if (!isPartnerCode(code)) return;
    try {
      if (sessionStorage.getItem(SENT) === code) return;
    } catch {}
    const landing = location.pathname.slice(0, 200);
    const source = (q.get("utm_source") ?? "").slice(0, 80);
    const send = () => {
      try {
        sessionStorage.setItem(SENT, code);
      } catch {}
      void fetch("/api/partners/visit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, landing, source }), keepalive: true }).catch(() => {});
    };
    const now = consented();
    if (now === true) return send();
    if (now === false) return;
    const on = () => {
      if (consented()) send();
    };
    window.addEventListener(CONSENT_EVENT, on, { once: true });
    return () => window.removeEventListener(CONSENT_EVENT, on);
  }, []);
  return null;
}
