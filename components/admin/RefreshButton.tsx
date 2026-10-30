"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, RefreshCw, TriangleAlert } from "lucide-react";

const hhmm = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Re-reads the list on the server without reloading the page (1053). router.refresh() keeps the URL, so search,
 * filters, sort, page and scroll all stay put; only the data changes. A quick check first turns a dropped
 * connection or an expired admin session into a clear message instead of a silent no-op. One run at a time.
 */
export function RefreshButton({ total, noun = "users", loadedAt }: { total: number; noun?: string; loadedAt: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [last, setLast] = useState(() => new Date(loadedAt));
  const busy = useRef(false);
  const before = useRef<number | null>(null);
  const running = pending || checking;

  // The refreshed page hands us its new total: say what changed once the transition settles.
  useEffect(() => {
    if (pending || before.current === null) return;
    const diff = total - before.current;
    before.current = null;
    busy.current = false;
    setLast(new Date());
    setMsg({ ok: true, text: diff > 0 ? `${diff} new ${diff === 1 ? noun.replace(/s$/, "") : noun}` : "Up to date" });
  }, [pending, total, noun]);

  useEffect(() => {
    if (!msg?.ok) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  async function refresh() {
    if (busy.current) return;
    busy.current = true;
    setMsg(null);
    setChecking(true);
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("You're offline. Check the connection and try again.");
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 12_000);
      const r = await fetch(window.location.href, { method: "HEAD", cache: "no-store", credentials: "same-origin", redirect: "manual", signal: ctl.signal }).finally(() => clearTimeout(t));
      if (r.type === "opaqueredirect" || r.status === 401 || r.status === 403) throw new Error("Your admin session ended. Sign in again to refresh.");
      if (!r.ok) throw new Error("The server didn't answer. Try again in a moment.");
    } catch (e) {
      busy.current = false;
      setChecking(false);
      const text = e instanceof Error && e.name !== "AbortError" && !/fetch/i.test(e.message) ? e.message : "Couldn't reach Outlly. Check the connection and try again.";
      setMsg({ ok: false, text });
      return;
    }
    setChecking(false);
    before.current = total;
    start(() => router.refresh());
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span aria-live="polite" className="flex min-h-5 items-center gap-1.5 text-[12.5px]">
        {msg ? (
          <span className={msg.ok ? "flex items-center gap-1.5 pill-ink-ok" : "flex items-center gap-1.5 pill-ink-bad"} role={msg.ok ? undefined : "alert"}>
            {msg.ok ? <Check className="h-3.5 w-3.5" aria-hidden /> : <TriangleAlert className="h-3.5 w-3.5" aria-hidden />}
            {msg.text}
          </span>
        ) : (
          <span className="text-muted-foreground">Last refreshed {hhmm(last)}</span>
        )}
      </span>
      <button
        type="button"
        onClick={refresh}
        disabled={running}
        aria-busy={running}
        className="inline-flex h-11 items-center gap-2 rounded-full bg-secondary px-4 text-[13.5px] font-semibold hairline transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--lime))] focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-wait disabled:opacity-70"
      >
        {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
        {running ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}
