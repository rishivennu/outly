"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";

/**
 * R1324: the one switch for shared learning. R1334: its own file, so a creator without the Personal Intelligence perk
 * still reaches it (consent is theirs whatever the plan; Phase 2 turns it into the full consent record).
 * On, this workspace's measured posts join anonymised cohort medians
 * (never fewer than 5 creators and 20 posts per bucket, no single creator above half); off, they stay home. Either
 * way the creator's own estimates still read the shared baseline when they have little history of their own.
 */
type Sharing = { share: boolean; canChange: boolean; rules: { minOwners: number; minPosts: number; windowDays: number } };

export function SharingRow() {
  const [state, setState] = useState<Sharing | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    api<Sharing>("/api/intelligence/sharing")
      .then((r) => live && setState(r))
      .catch(() => live && setState(null));
    return () => {
      live = false;
    };
  }, []);
  if (!state) return null;
  const { share, canChange, rules } = state;
  const flip = async () => {
    if (!canChange) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await api<Sharing>("/api/intelligence/sharing", { method: "PATCH", json: { share: !share } });
      setState(r);
      setNote({ text: r.share ? "Your posts join the next hourly rebuild." : "Your posts leave the shared baselines at the next hourly rebuild.", error: false });
    } catch (e) {
      setNote({ text: e instanceof ApiError ? e.message : "That didn't save. Try again in a moment.", error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-secondary/40 p-4 hairline">
      <div className="min-w-0 flex-1">
        <p id="intel-sharing-label" className="text-sm font-medium">Help the shared baselines</p>
        <p id="intel-sharing-hint" className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
          Your measured posts join anonymised medians (never fewer than {rules.minOwners} creators and {rules.minPosts} posts in a group, no one creator more than half of it). Nothing of yours is shown to anyone; new creators get a fairer starting estimate. You keep reading them either way.
          {!canChange && " Only the workspace owner can change this."}
        </p>
        {/* Both regions stay mounted so a screen reader announces the text when it arrives. */}
        <p className="mt-1.5 text-[13px] text-muted-foreground empty:hidden" role="status" aria-live="polite">{note && !note.error ? note.text : ""}</p>
        <p className="mt-1.5 text-[13px] text-destructive empty:hidden" role="alert">{note?.error ? note.text : ""}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={share}
        aria-labelledby="intel-sharing-label"
        aria-describedby="intel-sharing-hint"
        disabled={busy || !canChange}
        onClick={flip}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${share ? "bg-lime" : "bg-muted"}`}
      >
        <span className={`inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${share ? "translate-x-6" : "translate-x-1"}`} aria-hidden />
      </button>
    </div>
  );
}
