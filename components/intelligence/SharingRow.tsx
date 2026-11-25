"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { consentStatusLine, type ConsentSource, type ConsentView } from "@/lib/intelligence/consent-core";

/**
 * R1324 → R1335: the one switch for "Help improve Outlly AI". Its own file so a creator on any plan reaches it (consent
 * is theirs whatever the plan; it never unlocks Personal Intelligence). Reads and writes the consent record through
 * /api/intelligence/sharing; the switch shows the server's state and nothing else, so it is never preselected: a creator
 * who has not decided sees it off. Under it: the exact explanation they agree to, what it covers, what is never
 * included, when they said yes and under which policy version, and a way to withdraw or to ask for contributed data to
 * be removed. Shown under Your baselines (paid), on the upgrade card (free) and in Settings > Data & Privacy.
 */
type Sharing = ConsentView & { share: boolean; canChange: boolean; rules: { minOwners: number; minPosts: number; windowDays: number }; contribution: { status: string; records: number; builds: number; since: string; last: string; deleted: boolean } | null };

export function SharingRow({ source = "intelligence" }: { source?: ConsentSource }) {
  const [state, setState] = useState<Sharing | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
  const { canChange, rules, copy, categories, never, contribution } = state;
  const s = state.state;
  const granted = s.granted;

  const act = async (action: "grant" | "withdraw" | "request-deletion") => {
    if (!canChange) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await api<Sharing>("/api/intelligence/sharing", { method: "PATCH", json: { action, source } });
      setState(r);
      setConfirmDelete(false);
      setNote({
        text: action === "grant" ? "Thank you. Your measured posts join the next hourly rebuild." : action === "withdraw" ? copy.withdraw : copy.deletion,
        error: false,
      });
    } catch (e) {
      setNote({ text: e instanceof ApiError ? e.message : "That didn't save. Try again in a moment.", error: true });
    } finally {
      setBusy(false);
    }
  };
  const flip = () => act(granted ? "withdraw" : "grant");

  return (
    <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-secondary/40 p-4 hairline" data-consent={granted ? "granted" : "off"}>
      <div className="min-w-0 flex-1">
        <p id="intel-sharing-label" className="text-sm font-medium">{copy.title}</p>
        <p id="intel-sharing-hint" className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
          {copy.explanation}
          {!canChange && " Only the workspace owner can change this."}
        </p>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          {consentStatusLine(s)}
          {s.policyVersion && <span className="text-muted-foreground/70"> Policy {s.granted ? s.policyVersion : state.policyVersion}.</span>}
          {contribution && !contribution.deleted && contribution.status === "active" && (
            <span> {contribution.records} of your measured posts went into the latest build; part of {contribution.builds} build{contribution.builds === 1 ? "" : "s"} since {new Date(contribution.since).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.</span>
          )}
          {contribution?.deleted && <span> The record of which of your posts were used has been cleared.</span>}
        </p>
        <details className="mt-2 text-[13px] text-muted-foreground">
          <summary className="cursor-pointer select-none font-medium text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md">What this covers</summary>
          <ul className="mt-1.5 space-y-1">
            {categories.map((c) => (
              <li key={c.key}>
                <span className="font-medium text-foreground/80">{c.label}.</span> {c.detail}
              </li>
            ))}
          </ul>
          <p className="mt-2">
            Only groups of at least {rules.minOwners} creators and {rules.minPosts} posts, no one creator more than half of a group, last {rules.windowDays} days. Medians only: nothing of yours is shown to anyone, and this never changes your own estimates.
          </p>
          <p className="mt-2 font-medium text-foreground/80">Never included, consent or not</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {never.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
        {canChange && s.decisions > 0 && s.deletion?.status !== "requested" && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
            {granted && !s.current && (
              <button type="button" disabled={busy} onClick={() => act("grant")} className="rounded-full bg-foreground px-3 py-1 font-medium text-background disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                I've read it, keep helping
              </button>
            )}
            {!confirmDelete ? (
              <button type="button" disabled={busy} onClick={() => setConfirmDelete(true)} className="text-muted-foreground underline-offset-2 hover:underline disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md">
                Remove my contributed data
              </button>
            ) : (
              <span className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm removing your contributed data">
                <span>Remove your posts from the shared model and the record of which were used?</span>
                <button type="button" disabled={busy} onClick={() => act("request-deletion")} className="rounded-full bg-destructive/90 px-3 py-1 font-medium text-destructive-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Yes, remove it
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)} className="rounded-full px-3 py-1 font-medium hairline disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Keep it
                </button>
              </span>
            )}
          </div>
        )}
        {/* Both regions stay mounted so a screen reader announces the text when it arrives. */}
        <p className="mt-1.5 text-[13px] text-muted-foreground empty:hidden" role="status" aria-live="polite">{note && !note.error ? note.text : ""}</p>
        <p className="mt-1.5 text-[13px] text-destructive empty:hidden" role="alert">{note?.error ? note.text : ""}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={granted}
        aria-labelledby="intel-sharing-label"
        aria-describedby="intel-sharing-hint"
        disabled={busy || !canChange}
        onClick={flip}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${granted ? "bg-lime" : "bg-muted"}`}
      >
        <span className={`inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${granted ? "translate-x-6" : "translate-x-1"}`} aria-hidden />
      </button>
    </div>
  );
}
