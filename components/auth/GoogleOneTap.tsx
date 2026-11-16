"use client";
import { useEffect, useRef } from "react";
import { api, ApiError } from "@/lib/client/api";
import { NATIVE_UA } from "@/lib/app-mode";

const GSI_SRC = "https://accounts.google.com/gsi/client";

type GsiCredential = { credential: string; select_by?: string };
type Gsi = {
  accounts: {
    id: {
      initialize(o: { client_id: string; callback: (r: GsiCredential) => void; context?: "signin" | "signup" | "use"; cancel_on_tap_outside?: boolean; itp_support?: boolean; use_fedcm_for_prompt?: boolean }): void;
      prompt(): void;
      cancel(): void;
    };
  };
};
declare global {
  interface Window {
    google?: Gsi;
  }
}

/** The script once per page; later mounts reuse it. A failed load removes its tag, so the next try fetches again. */
function loadGsi(): Promise<Gsi | null> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  return new Promise((res) => {
    let s = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const done = () => res(window.google?.accounts?.id ? window.google : null);
    const failed = () => {
      s?.remove();
      res(null);
    };
    if (!s) {
      s = document.createElement("script");
      s.src = GSI_SRC;
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }
    s.addEventListener("load", done, { once: true });
    s.addEventListener("error", failed, { once: true });
  });
}

/**
 * Google One Tap on the sign-in and sign-up pages (lib/google-one-tap.ts): Google's own prompt lists the Google
 * accounts this browser is signed in to; one tap posts the ID token to /api/auth/google/one-tap and the form
 * carries on exactly as after a password: in, or on to the authenticator step. Nothing renders here; Google
 * draws the prompt (top right on desktop, a sheet on phones) and hides it again on its own.
 *   - Not in the Outlly app's WebView: Google blocks its sign-in there, the app has its own Custom Tab flow.
 *   - Not after a Google error on this page load: the visitor just saw one, so no second prompt on top of it.
 * Google's library is initialised once per page; `active` only shows or hides the prompt (sign-up: once the 18+
 * box is ticked; sign-in: on the first step), so a toggled checkbox does not initialise it again. A credential is
 * ignored while the form is already signing in (`blocked`), and a second one while the first is on its way.
 */
export function GoogleOneTap({ clientId, mode, active, remember, adult, blocked, onBusy, onDone, onError }: {
  clientId: string;
  mode: "login" | "signup";
  active: boolean;
  remember?: boolean;
  adult?: boolean;
  /** True while the form is busy with another sign-in: the tap is dropped, not queued. */
  blocked?: () => boolean;
  onBusy: (b: boolean) => void;
  onDone: (r: { twoFactor?: boolean; created?: boolean }) => void;
  onError: (code: string | undefined, message: string) => void;
}) {
  // The latest form state, read when Google calls back (it is initialised once).
  const latest = useRef({ active, remember, adult, blocked, onBusy, onDone, onError });
  latest.current = { active, remember, adult, blocked, onBusy, onDone, onError };
  const sending = useRef(false);
  const gsi = useRef<Gsi | null>(null);
  useEffect(() => {
    if (!clientId || typeof window === "undefined" || navigator.userAgent.includes(NATIVE_UA)) return;
    let live = true;
    void loadGsi().then((g) => {
      if (!g || !live) return;
      gsi.current = g;
      g.accounts.id.initialize({
        client_id: clientId,
        context: mode === "signup" ? "signup" : "signin",
        cancel_on_tap_outside: false,
        itp_support: true,
        use_fedcm_for_prompt: true,
        callback: async ({ credential }) => {
          const l = latest.current;
          if (!l.active || sending.current || l.blocked?.()) return;
          sending.current = true;
          l.onBusy(true);
          try {
            const r = await api<{ ok: boolean; redirect?: string; twoFactor?: boolean; created?: boolean }>("/api/auth/google/one-tap", {
              method: "POST",
              json: { credential, remember: l.remember, adult: l.adult },
            });
            if (r.redirect) {
              window.location.assign(r.redirect);
              return;
            }
            l.onDone(r);
          } catch (e) {
            sending.current = false;
            l.onBusy(false);
            l.onError(e instanceof ApiError ? e.code : undefined, e instanceof ApiError ? e.message : "Couldn't reach Outlly. Check your connection and try again.");
          }
        },
      });
      if (latest.current.active) g.accounts.id.prompt();
    });
    return () => {
      live = false;
      gsi.current = null;
      window.google?.accounts?.id?.cancel();
    };
  }, [clientId, mode]);
  // Show or hide the prompt as the form's state allows it, on the already initialised library.
  useEffect(() => {
    const g = gsi.current;
    if (!g) return;
    if (active) g.accounts.id.prompt();
    else g.accounts.id.cancel();
  }, [active]);
  return null;
}
