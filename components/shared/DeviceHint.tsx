"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Laptop, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readConsent } from "@/components/shared/CookieConsent";
import { cn } from "@/lib/utils";

/** Once per device. Bump the value to show it again to everyone. */
export const DEVICE_HINT_KEY = "outlly:device-hint";
const PHONE = "(max-width: 767px)";

/**
 * Small "best on a laptop" note for phones (10-17). Non-blocking: it never takes focus, waits until the
 * cookie bar has been answered so the two never stack, and lifts above the studio's floating mobile nav.
 */
export function DeviceHint() {
  const path = usePathname();
  const [show, setShow] = useState(false);
  const [lift, setLift] = useState(false);
  useEffect(() => setLift(!!document.querySelector('nav[aria-label="Primary"].fixed')), [path, show]);

  useEffect(() => {
    let seen = true;
    try { seen = !!localStorage.getItem(DEVICE_HINT_KEY); } catch {}
    if (seen || !window.matchMedia(PHONE).matches) return;
    let t: number | undefined;
    const arm = () => { t = window.setTimeout(() => window.matchMedia(PHONE).matches && setShow(true), 900); };
    if (readConsent()) arm();
    else window.addEventListener("outly:consent", arm, { once: true });
    return () => { window.clearTimeout(t); window.removeEventListener("outly:consent", arm); };
  }, []);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function close() {
    try { localStorage.setItem(DEVICE_HINT_KEY, new Date().toISOString()); } catch {}
    setShow(false);
  }

  if (!show || path.startsWith("/admin")) return null;
  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="dh-title"
      aria-describedby="dh-body"
      className={cn("consent-in glass-strong fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-[60] rounded-[22px] p-3.5 pr-2 shadow-2xl md:hidden", lift && "bottom-[92px]")}
      style={{ animationDelay: "0s" }}
    >
      <div className="flex items-start gap-3">
        <span className="lime-bg grid h-10 w-10 shrink-0 place-items-center rounded-2xl" aria-hidden="true"><Laptop className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 id="dh-title" className="text-[15px] font-semibold leading-tight tracking-tight">Best on a laptop</h2>
          <p id="dh-body" className="mt-1 text-[13px] leading-snug text-muted-foreground">
            Outlly works on your phone, but editing, previews and scheduling are easier on a bigger screen.
          </p>
          <Button size="sm" variant="primary" className="mt-3 h-11 px-5" onClick={close}>Got it</Button>
        </div>
        <button type="button" onClick={close} aria-label="Close" className="-mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
