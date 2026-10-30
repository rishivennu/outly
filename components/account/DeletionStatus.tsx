"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type View = { status: "running" | "done" | "failed"; filesTotal: number; filesDone: number; message: string };
type State = { kind: "loading" } | { kind: "missing" } | { kind: "error" } | { kind: "ok"; v: View };

const POLL_MS = 5_000;
// About 20 minutes of watching; the sweeper keeps going after that, the page just stops asking.
const MAX_POLLS = 240;

/** Reads the token from the hash, then polls while files are still being removed. Pauses on a hidden tab. */
export function DeletionStatus() {
  const [s, setS] = useState<State>({ kind: "loading" });
  const token = useRef<string | null>(null);
  const polls = useRef(0);

  const load = useCallback(async () => {
    const t = token.current;
    if (!t) return setS({ kind: "missing" });
    try {
      const r = await fetch("/api/account-deletion", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: t }), cache: "no-store" });
      if (r.status === 404) return setS({ kind: "missing" });
      if (!r.ok) return setS((p) => (p.kind === "ok" ? p : { kind: "error" }));
      setS({ kind: "ok", v: (await r.json()) as View });
    } catch {
      setS((p) => (p.kind === "ok" ? p : { kind: "error" }));
    }
  }, []);

  useEffect(() => {
    const h = window.location.hash.replace(/^#/, "").trim();
    token.current = /^[A-Za-z0-9_-]{20,100}$/.test(h) ? h : null;
    void load();
  }, [load]);

  const running = s.kind === "ok" && s.v.status === "running" && s.v.filesTotal > 0;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (++polls.current > MAX_POLLS) return window.clearInterval(id);
      void load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [running, load]);

  if (s.kind === "loading") {
    return (
      <div role="status" aria-live="polite" className="space-y-3">
        <span className="sr-only">Checking the deletion status</span>
        <div className="h-4 w-4/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <div className="h-4 w-3/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      </div>
    );
  }
  if (s.kind === "missing") {
    return (
      <>
        <p>We can&apos;t show the cleanup status from this link. It may have expired, since status records are kept for 30 days. Your account and its data were deleted when you confirmed.</p>
        <Footer />
      </>
    );
  }
  if (s.kind === "error") {
    return (
      <>
        <p role="alert">We couldn&apos;t check the status just now. Your account is still deleted; this only affects the progress view.</p>
        <div className="mt-8"><Button variant="outline" onClick={() => { setS({ kind: "loading" }); void load(); }}>Try again</Button></div>
      </>
    );
  }

  const { v } = s;
  const pct = v.filesTotal === 0 ? 100 : Math.round((v.filesDone / v.filesTotal) * 100);
  return (
    <>
      <p aria-live="polite">{v.message}</p>
      {v.filesTotal > 0 && (
        <div className="mt-6">
          <div className="mb-2 flex justify-between text-sm">
            <span>Uploaded files</span>
            <span className="tabular-nums">{v.filesDone} of {v.filesTotal}</span>
          </div>
          <div
            role="progressbar"
            aria-label="Uploaded files removed"
            aria-valuemin={0}
            aria-valuemax={v.filesTotal}
            aria-valuenow={v.filesDone}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div className={`h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${v.status === "failed" ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {v.status === "failed" && <p className="mt-4 text-sm">You don&apos;t need to do anything. If you have questions, write to us from the contact page.</p>}
      <Footer />
    </>
  );
}

function Footer() {
  return (
    <div className="mt-8 flex flex-wrap gap-3">
      <Button asChild variant="lime"><Link href="/">Back to Outlly</Link></Button>
      <Button asChild variant="ghost"><Link href="/contact">Contact us</Link></Button>
    </div>
  );
}
