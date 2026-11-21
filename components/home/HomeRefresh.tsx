"use client";
import { type ReactNode, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PullToRefresh } from "@/components/ui/easy/PullToRefresh";
import { isInstalled } from "@/lib/client/fresh-on-resume";

/** Only the installed app on a touch screen: a browser tab has its own pull to refresh, and a mouse cannot pull. */
export function canPull(w: { matchMedia?: (q: string) => { matches: boolean }; navigator?: object; document?: { documentElement: { hasAttribute: (name: string) => boolean } } }): boolean {
  try {
    return isInstalled(w) && !!w.matchMedia?.("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/**
 * R1288: Home in the installed app refreshes with a pull from the top. router.refresh() re-runs the server page in
 * place (scroll and shell kept); the pull resolves once that transition has committed, so "Updated" means updated.
 */
export function HomeRefresh({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [pending, start] = useTransition();
  const done = useRef<(() => void) | null>(null);
  useEffect(() => setEnabled(canPull(window)), []);
  useEffect(() => {
    if (!pending && done.current) {
      done.current();
      done.current = null;
    }
  }, [pending]);
  const refresh = useCallback(
    () =>
      new Promise<void>((resolve) => {
        // A refresh that never commits (offline, aborted) must not leave the pill spinning.
        const cap = window.setTimeout(resolve, 15_000);
        done.current = () => {
          window.clearTimeout(cap);
          resolve();
        };
        start(() => router.refresh());
      }),
    [router],
  );
  return (
    <PullToRefresh enabled={enabled} onRefresh={refresh} refreshLabel="Refresh Home">
      {children}
    </PullToRefresh>
  );
}
