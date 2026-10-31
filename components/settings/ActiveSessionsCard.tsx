"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Laptop, Loader2, LogOut, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import type { SessionRow } from "@/lib/sessions";

type Res = { sessions: SessionRow[]; legacyNote: boolean; signedOut?: number };

const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }) : null;
/** "Active now" inside five minutes (touchSession writes no more often), then "3 hours ago" style. */
export function lastActive(iso: string, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 300) return "Active now";
  const [n, u]: [number, Intl.RelativeTimeFormatUnit] = s < 3600 ? [Math.round(s / 60), "minute"] : s < 86_400 ? [Math.round(s / 3600), "hour"] : [Math.round(s / 86_400), "day"];
  return `Active ${rtf ? rtf.format(-n, u) : `${n} ${u}s ago`}`;
}
const since = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Active sessions (1080): every browser or app signed in to this account, this one pinned on top. Signing one out
 * ends it at its next request. The spinner waits 150 ms so a fast answer never flashes one; the row then folds
 * away and focus moves to the next row, so a keyboard user keeps their place.
 */
export function ActiveSessionsCard() {
  const [list, setList] = useState<SessionRow[] | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [spin, setSpin] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const btns = useRef(new Map<string, HTMLButtonElement>());
  const othersBtn = useRef<HTMLButtonElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const load = useCallback(
    () =>
      api<Res>("/api/me/sessions")
        .then((r) => {
          setList(r.sessions);
          setLegacy(r.legacyNote);
          setFailed(false);
        })
        .catch(() => setFailed(true)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (confirm) confirmBtn.current?.focus();
  }, [confirm]);

  /** Runs `work` with the delayed spinner on `key`. */
  const withSpin = async <T,>(key: string, work: () => Promise<T>) => {
    setBusy(key);
    setErr("");
    const t = setTimeout(() => setSpin(key), 150);
    try {
      return await work();
    } finally {
      clearTimeout(t);
      setSpin(null);
      setBusy(null);
    }
  };

  const others = (list ?? []).filter((s) => !s.current);

  const signOut = async (row: SessionRow) => {
    const idx = others.findIndex((s) => s.id === row.id);
    const after = others[idx + 1] ?? others[idx - 1] ?? null;
    try {
      const r = await withSpin(row.id, () => api<Res>(`/api/me/sessions?id=${encodeURIComponent(row.id)}`, { method: "DELETE" }));
      setLeaving(row.id);
      await new Promise((ok) => setTimeout(ok, reduced() ? 0 : 320));
      setList(r.sessions);
      setLegacy(r.legacyNote);
      setLeaving(null);
      setMsg(`Signed out ${row.label}.`);
      requestAnimationFrame(() => (after ? btns.current.get(after.id) : othersBtn.current ?? heading.current)?.focus());
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setMsg("That session had already ended.");
        void load();
        return;
      }
      setErr(e instanceof ApiError ? e.message : "Couldn't sign that session out. Try again.");
    }
  };

  const signOutOthers = async () => {
    try {
      const r = await withSpin("others", () => api<Res>("/api/me/sessions?others=1", { method: "DELETE" }));
      setConfirm(false);
      setList(r.sessions);
      setLegacy(false);
      const n = r.signedOut ?? 0;
      setMsg(n === 1 ? "Signed out 1 other session." : n > 1 ? `Signed out ${n} other sessions.` : "Every other device is signed out.");
      requestAnimationFrame(() => heading.current?.focus());
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't sign the other sessions out. Try again.");
    }
  };

  const cancelConfirm = () => {
    setConfirm(false);
    requestAnimationFrame(() => othersBtn.current?.focus());
  };

  const Ico = (s: SessionRow) => (s.app || /Android|iPhone|iPad/.test(s.label) ? Smartphone : Laptop);

  return (
    <section className="glass rounded-[32px] p-6 sm:p-8" aria-labelledby="as-h" aria-busy={list === null && !failed}>
      <div className="min-w-0">
        <h2 id="as-h" ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">Active sessions</h2>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          Phones and computers signed in to your account. Don&apos;t recognise one? Sign it out, then change your password.
        </p>
      </div>
      <p aria-live="polite" className="sr-only">{msg}</p>
      {err && <p role="alert" className="mt-3 text-sm text-destructive">{err}</p>}
      {failed ? (
        <p role="alert" className="mt-4 flex flex-wrap items-center gap-3 text-sm text-destructive">
          Couldn&apos;t load your sessions.
          <Button variant="outline" onClick={() => void load()}>Try again</Button>
        </p>
      ) : list === null ? (
        <ul className="mt-4 space-y-2" aria-hidden="true">
          {[0, 1].map((i) => <li key={i} className="h-16 animate-pulse rounded-2xl bg-secondary/50" />)}
        </ul>
      ) : (
        <ul className="mt-4 overflow-hidden rounded-2xl hairline" aria-label="Signed-in devices">
          {list.map((s, i) => {
            const I = Ico(s);
            return (
              <li key={s.id} className={cn("sess-row", leaving === s.id && "is-leaving", i > 0 && "border-t border-border/60")}>
                <div className="sess-row-in">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                    <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", s.current ? "bg-lime/15 text-lime-ink" : "bg-secondary text-muted-foreground")}>
                      <I className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium">
                        {s.label}
                        {s.current && <span className="rounded-full bg-lime/15 px-2 py-0.5 text-[11px] font-semibold text-lime-ink">This device</span>}
                      </p>
                      <p className="text-[12.5px] text-muted-foreground">
                        {s.place ? <>Around {s.place} (approximate) · </> : null}
                        {s.current ? "Active now" : lastActive(s.lastSeenAt)}
                        {!s.legacy && <> · Signed in {since(s.createdAt)}</>}
                      </p>
                    </div>
                    {!s.current && (
                      <Button
                        ref={(el) => {
                          if (el) btns.current.set(s.id, el);
                          else btns.current.delete(s.id);
                        }}
                        variant="ghost"
                        size="sm"
                        className="h-11 min-w-[104px]"
                        onClick={() => void signOut(s)}
                        disabled={busy !== null}
                        aria-label={`Sign out ${s.label}${s.place ? `, around ${s.place}` : ""}`}
                      >
                        {spin === s.id ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
                        {busy === s.id ? "Signing out" : "Sign out"}
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {list && others.length === 0 && (
        <p className="mt-3 text-[13px] text-muted-foreground">No other sessions. You&apos;re only signed in here.</p>
      )}
      {legacy && (
        <p className="mt-3 rounded-2xl bg-secondary/40 p-3 text-[13px] text-muted-foreground">
          Devices signed in before 1 November show up here after their next sign-in. To end them now, use Sign out other sessions.
        </p>
      )}
      {list && (others.length > 0 || legacy) && (
        <div className="mt-4" onKeyDown={(e) => { if (e.key === "Escape" && confirm) { e.stopPropagation(); cancelConfirm(); } }}>
          {confirm ? (
            <div role="group" aria-labelledby="as-confirm" className="flex flex-wrap items-center gap-2 rounded-2xl bg-secondary/40 p-3">
              <p id="as-confirm" className="mr-auto text-[13.5px] font-medium">
                Sign out {others.length > 0 ? `${others.length} other ${others.length === 1 ? "session" : "sessions"}` : "every other device"}? This one stays signed in.
              </p>
              <Button ref={confirmBtn} variant="danger" size="sm" className="h-11" onClick={() => void signOutOthers()} disabled={busy !== null}>
                {spin === "others" && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                {busy === "others" ? "Signing out" : "Sign them out"}
              </Button>
              <Button variant="ghost" size="sm" className="h-11" onClick={cancelConfirm} disabled={busy === "others"}>Cancel</Button>
            </div>
          ) : (
            <Button ref={othersBtn} variant="outline" onClick={() => setConfirm(true)} disabled={busy !== null}>
              <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out other sessions
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
