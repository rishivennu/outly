"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Cookie } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const CONSENT_KEY = "outly-consent";
export type Consent = { v: 1; necessary: true; analytics: boolean; marketing: boolean; at: string };

export function readConsent(): Consent | null {
  try {
    const c = JSON.parse(localStorage.getItem(CONSENT_KEY) ?? "null");
    return c?.v === 1 ? c : null;
  } catch {
    return null;
  }
}
function save(c: Omit<Consent, "v" | "necessary" | "at">) {
  const full: Consent = { v: 1, necessary: true, ...c, at: new Date().toISOString() };
  localStorage.setItem(CONSENT_KEY, JSON.stringify(full));
  // a cookie too, so the server can respect the choice before any script runs
  document.cookie = `${CONSENT_KEY}=${full.analytics ? "a" : ""}${full.marketing ? "m" : ""}n; Path=/; Max-Age=${60 * 60 * 24 * 180}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  window.dispatchEvent(new CustomEvent("outly:consent", { detail: full }));
}

const ROWS = [
  { id: "necessary", title: "Necessary", body: "Sign-in, security, your theme and this choice. Always on, the site can't work without them." },
  { id: "analytics", title: "Analytics", body: "Anonymous counts of which pages are used, so we can fix what's confusing." },
  { id: "marketing", title: "Marketing", body: "Lets us measure whether our ads work. We never sell your data." },
] as const;

/** GDPR/DPDP-style banner: equal-weight Accept and Reject, granular Customize, re-openable from the footer. */
export function CookieBanner() {
  const path = usePathname();
  const [show, setShow] = useState(false);
  const [custom, setCustom] = useState(false);
  const [prefs, setPrefs] = useState({ analytics: false, marketing: false });
  const [lift, setLift] = useState(false); // clear the studio's floating mobile nav
  useEffect(() => setLift(!!document.querySelector('nav[aria-label="Primary"].fixed')), [path]);

  useEffect(() => {
    const c = readConsent();
    if (!c) setShow(true);
    else setPrefs({ analytics: c.analytics, marketing: c.marketing });
    const open = () => { const c2 = readConsent(); if (c2) setPrefs({ analytics: c2.analytics, marketing: c2.marketing }); setCustom(true); setShow(true); };
    window.addEventListener("outly:consent-open", open);
    return () => window.removeEventListener("outly:consent-open", open);
  }, []);

  if (!show || path.startsWith("/admin")) return null;
  const done = (c: { analytics: boolean; marketing: boolean }) => { save(c); setShow(false); setCustom(false); };

  return (
    <section role="dialog" aria-modal="false" aria-labelledby="cc-title" aria-describedby="cc-body" className={cn("consent-in glass-strong fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-[60] mx-auto max-w-[560px] rounded-[28px] p-5 shadow-2xl sm:left-5 sm:right-auto sm:mx-0 sm:p-6", lift && "max-lg:bottom-[96px]")}>
      <div className="flex items-start gap-3">
        <span className="lime-bg grid h-10 w-10 shrink-0 place-items-center rounded-2xl" aria-hidden><Cookie className="h-5 w-5" /></span>
        <div className="min-w-0">
          <h2 id="cc-title" className="font-semibold tracking-tight">Cookies, your call</h2>
          <p id="cc-body" className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
            We use necessary cookies to run Outlly. With your OK we'd also use analytics to improve it. <Link href="/privacy" className="font-medium text-foreground underline underline-offset-4">Privacy policy</Link>
          </p>
        </div>
      </div>

      <div className="liquid-panel" data-open={custom}>
        <div>
          <ul className="liquid-inner mt-4 space-y-2">
            {ROWS.map((r) => {
              const locked = r.id === "necessary";
              const on = locked || prefs[r.id as "analytics" | "marketing"];
              return (
                <li key={r.id} className="flex items-start gap-3 rounded-2xl p-3 hairline">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{r.title}</p>
                    <p className="text-[12.5px] text-muted-foreground">{r.body}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`${r.title} cookies`}
                    disabled={locked}
                    onClick={() => setPrefs((p) => ({ ...p, [r.id]: !p[r.id as "analytics" | "marketing"] }))}
                    className={cn("relative mt-0.5 box-border inline-flex h-7 w-12 min-w-12 shrink-0 items-center overflow-hidden rounded-full p-1 transition-colors duration-300 disabled:opacity-60", on ? "bg-lime" : "bg-secondary hairline")}
                  >
                    <span aria-hidden="true" className={cn("block h-5 w-5 shrink-0 rounded-full bg-white shadow transition-transform duration-500 [transition-timing-function:var(--ease-liquid)]", on ? "translate-x-5" : "translate-x-0")} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {custom ? (
          <Button size="sm" variant="lime" onClick={() => done(prefs)}>Save choices</Button>
        ) : (
          <>
            <Button size="sm" variant="primary" onClick={() => done({ analytics: true, marketing: true })}>Accept all</Button>
            <Button size="sm" variant="primary" onClick={() => done({ analytics: false, marketing: false })}>Reject all</Button>
          </>
        )}
        <Button size="sm" variant="ghost" aria-expanded={custom} onClick={() => setCustom((c) => !c)}>{custom ? "Back" : "Customize"}</Button>
      </div>
    </section>
  );
}

export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new CustomEvent("outly:consent-open"))}>
      Cookie settings
    </button>
  );
}
