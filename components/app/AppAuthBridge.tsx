"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, CircleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isNative, nativeCall, nativeOn, openInBrowser } from "@/lib/client/native";
import { BridgeScreen } from "./BridgeScreen";

const VERIFIER_KEY = "outlly_app_verifier";
const MAX_AGE_MS = 15 * 60_000;

type State = "starting" | "browser" | "closed" | "finishing" | "error";

function randomVerifier() {
  const b = crypto.getRandomValues(new Uint8Array(48));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function challengeOf(verifier: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...d)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// localStorage, not sessionStorage: Android may close the app while the Custom Tab is open.
function storeVerifier(v: string) {
  localStorage.setItem(VERIFIER_KEY, JSON.stringify({ v, at: Date.now() }));
}
function readVerifier(): string | null {
  try {
    const j = JSON.parse(localStorage.getItem(VERIFIER_KEY) ?? "null") as { v: string; at: number } | null;
    return j && Date.now() - j.at < MAX_AGE_MS ? j.v : null;
  } catch {
    return null;
  }
}

const back = () => (history.length > 1 ? history.back() : location.replace("/home"));
const home = () => location.replace("/home");
// Back from the page the flow ended on lands here again: step over it instead of starting a new sign-in.
const cameBack = () => (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type === "back_forward";

/**
 * The app's side of a sign-in or account connect that has to run in the browser (lib/app-handoff.ts).
 * ?to=  start: open the flow in a Custom Tab.   ?code=  the browser came back: finish here.   ?cancel  nothing to finish.
 */
export function AppAuthBridge() {
  const params = useSearchParams();
  const to = params.get("to");
  const code = params.get("code");
  const [state, setState] = useState<State>(code ? "finishing" : "starting");
  const [error, setError] = useState<string | null>(null);
  const link = useRef<string | null>(null);
  const once = useRef(false);

  const open = useCallback(async () => {
    if (!link.current) return;
    setState("browser");
    await openInBrowser(link.current).catch(() => {
      setError("The browser didn't open. Try again.");
      setState("error");
    });
  }, []);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    if (params.has("cancel") && !code) return void home();
    if (code) {
      void (async () => {
        void nativeCall("Browser", "close").catch(() => {});
        const verifier = readVerifier();
        localStorage.removeItem(VERIFIER_KEY);
        const r = verifier
          ? await fetch("/api/app/finish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, verifier }) }).catch(() => null)
          : null;
        const j = r?.ok ? ((await r.json()) as { next: string }) : null;
        if (j?.next) return location.replace(j.next);
        setError("That took too long, so we couldn't finish signing you in. Try once more.");
        setState("error");
      })();
      return;
    }
    if (!to) return void home();
    if (cameBack()) return void back();
    // Opened outside the app (a pasted link): the normal web flow works in a real browser.
    if (!isNative()) return void location.replace(to);
    void (async () => {
      const verifier = randomVerifier();
      storeVerifier(verifier);
      const r = await fetch("/api/app/handoff", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to, challenge: await challengeOf(verifier) }) }).catch(() => null);
      const j = r?.ok ? ((await r.json()) as { url: string }) : null;
      if (!j?.url) {
        setError("We couldn't start that. Check your connection and try again.");
        setState("error");
        return;
      }
      link.current = j.url;
      await open();
    })();
  }, [code, open, params, to]);

  useEffect(() => nativeOn("Browser", "browserFinished", () => setState((s) => (s === "browser" ? "closed" : s))), []);
  useEffect(() => {
    const restored = (e: PageTransitionEvent) => e.persisted && to && back();
    addEventListener("pageshow", restored);
    return () => removeEventListener("pageshow", restored);
  }, [to]);
  const leave = code ? home : back;

  if (state === "error")
    return (
      <BridgeScreen icon={<CircleAlert className="h-8 w-8" />} title="Let's try that again" body={error ?? "Something got in the way."}>
        <Button variant="lime" size="lg" className="w-full max-w-xs" onClick={() => (to ? location.reload() : location.replace("/login"))}>Try again</Button>
        <Button variant="ghost" onClick={leave}>Go back</Button>
      </BridgeScreen>
    );
  if (state === "closed")
    return (
      <BridgeScreen icon={<ArrowUpRight className="h-8 w-8" />} title="Didn't finish?" body="The sign-in page was closed before it was done. Open it again to carry on.">
        <Button variant="lime" size="lg" className="w-full max-w-xs" onClick={open}>Open again</Button>
        <Button variant="ghost" onClick={leave}>Not now</Button>
      </BridgeScreen>
    );
  return (
    <BridgeScreen
      busy
      icon={<Loader2 className="h-8 w-8 motion-safe:animate-spin" />}
      title={state === "finishing" ? "Signing you in" : "Continue in the browser"}
      body={state === "finishing" ? "One moment." : "Google, Meta and the other platforms only let you sign in from a browser. You'll come straight back here."}
    />
  );
}
