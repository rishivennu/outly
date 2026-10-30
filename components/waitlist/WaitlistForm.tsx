"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";

type Joined = { already: boolean; position?: number; waiting?: number };
type Done = Joined & { email: string; name: string | null; at: string };

/*
 * The receipt is kept on this device (1055). The marketing template remounts the page on every navigation, so
 * pressing "Join the waitlist" again (or coming back tomorrow) used to drop people back on the empty form.
 */
const KEY = "outlly.waitlist.receipt";
const KEEP_MS = 30 * 86_400_000;

function load(): Done | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Done & { savedAt?: number };
    if (!v || typeof v.email !== "string" || !v.savedAt || Date.now() - v.savedAt > KEEP_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

/** Deterministic bars from the place in line, so every receipt has its own barcode. */
function bars(seed: string) {
  let h = 2166136261;
  const out: number[] = [];
  for (let i = 0; i < 30; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i % Math.max(seed.length, 1)) ^ i, 16777619) >>> 0;
    out.push(1 + (h % 4));
  }
  return out;
}

/** Apple-style sign-up card that is also a ticket printer: the receipt feeds out of its slot when you join. */
export function WaitlistForm({ fromGoogle = false }: { fromGoogle?: boolean }) {
  const [form, setForm] = useState({ name: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [badEmail, setBadEmail] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [play, setPlay] = useState(0); // 0 = show printed (restored), n > 0 = print run n
  const doneRef = useRef<HTMLHeadingElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const focusNext = useRef(false);
  const headRef = useRef<HTMLDivElement>(null);

  // The print head buzzes while the paper feeds, on every print run (a CSS rule would only fire on the first).
  useEffect(() => {
    if (!play || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const a = headRef.current?.animate(
      [{ transform: "translate3d(0, 0, 0)" }, { transform: "translate3d(.5px, -.4px, 0)" }, { transform: "translate3d(0, 0, 0)" }],
      { duration: 100, iterations: 24, delay: 200 },
    );
    return () => a?.cancel();
  }, [play]);

  useEffect(() => {
    const saved = load();
    if (saved) setDone(saved);
  }, []);

  useEffect(() => {
    if (done && focusNext.current) {
      focusNext.current = false;
      doneRef.current?.focus({ preventScroll: true });
    }
  }, [done]);

  // Any "#join" link on the page (hero button, nav button) lands the cursor in the email field, or on the receipt.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href$="#join"]');
      if (!a) return;
      window.setTimeout(() => (doneRef.current ?? emailRef.current)?.focus({ preventScroll: true }), 450);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return; // a double tap sends one request
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) {
      setError("Add the email you want the invite sent to.");
      setBadEmail(true);
      emailRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setBadEmail(false);
    try {
      const r = await api<Joined>("/api/waitlist", { method: "POST", json: { email: form.email, name: form.name || undefined, source: fromGoogle ? "google" : "page" } });
      const d: Done = { ...r, email: form.email.trim().toLowerCase(), name: form.name.trim() || null, at: new Date().toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) };
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...d, savedAt: Date.now() }));
      } catch {
        /* private mode: the receipt just won't survive a reload */
      }
      focusNext.current = true;
      setPlay((n) => n + 1);
      setDone(d);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something got in the way. Try again in a moment.");
      setBadEmail(err instanceof ApiError && err.status === 400);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing kept */
    }
    setDone(null);
    setPlay(0);
    setForm({ name: "", email: "" });
    window.setTimeout(() => emailRef.current?.focus(), 0);
  };

  if (done) {
    // The place in line is the real one the server counted, and only a fresh join gets it: anyone can type any
    // address, so an address already on the list learns nothing more.
    const fresh = !done.already && typeof done.position === "number" && done.position > 0;
    const rows: [string, string][] = [
      ...(done.name ? ([["Name", done.name]] as [string, string][]) : []),
      ["Email", done.email],
      ["Status", done.already ? "Spot kept" : "Waiting"],
      ...(fresh && done.position! > 1 ? ([["Ahead of you", (done.position! - 1).toLocaleString()]] as [string, string][]) : []),
    ];
    const b = bars(`${done.position ?? 0}${done.email}`);
    return (
      <div className="wl-printer" data-state="done" data-play={play > 0 ? "" : undefined}>
        <div ref={headRef} className="wl-card wl-head relative px-6 pb-7 pt-6 text-left sm:px-8">
          <p aria-live="polite" className="flex items-center gap-2.5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--ap-ink2))]">
            <span className="wl-led" aria-hidden="true" /> {play > 0 ? "Printed just now" : "Your receipt"}
          </p>
          <h2 ref={doneRef} tabIndex={-1} className="mt-2 font-display text-[28px] font-bold leading-tight tracking-[-0.02em] focus-visible:outline-offset-4">
            {done.already ? "You're already on the list." : "You're on the list."}
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-[hsl(var(--ap-ink2))]">
            {done.already ? (
              <>If your invite has already gone out, look for &ldquo;Your Outlly invite is here&rdquo; in your inbox (and spam).</>
            ) : (
              <>We&apos;ll email <b className="font-semibold text-foreground">{done.email}</b> the moment your spot comes up. One email, nothing else.</>
            )}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => setPlay((n) => n + 1)} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-4 text-[14px] font-semibold transition-colors hover:bg-foreground/[0.1]">
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Print it again
            </button>
            <button type="button" onClick={reset} className="inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-semibold text-[hsl(var(--ap-ink2))] underline-offset-4 hover:text-foreground hover:underline">
              Use a different email
            </button>
          </div>
          {/* Keyed by the print run so the print head glows again on a reprint. */}
          <div key={play} className="wl-slot" aria-hidden="true">
            <span />
          </div>
        </div>

        <div key={play} className="wl-feed" data-play={play > 0 ? "" : undefined}>
          <div>
            <article className="rcpt wl-rcpt" aria-label="Waitlist receipt">
              <p className="rcpt-brand text-center">OUTLLY</p>
              <p className="rcpt-dim mt-1 text-center uppercase tracking-[0.12em]">Waitlist receipt</p>
              <p className="rcpt-dim text-center">{done.at}</p>
              <hr className="rcpt-rule" />
              {fresh ? (
                <>
                  <p className="rcpt-dim text-center uppercase tracking-[0.12em]">Your number</p>
                  <p className="wl-num">
                    <span className="sr-only">Your place in line: </span>#{done.position!.toLocaleString()}
                  </p>
                </>
              ) : (
                <>
                  <p className="pt-3 text-center text-[14px] font-extrabold uppercase tracking-[0.08em]">Already on the list</p>
                  <span className="wl-stamp wl-stamp-inline" aria-hidden="true">ON FILE</span>
                </>
              )}
              {fresh && <span className="wl-stamp" aria-hidden="true">IN LINE</span>}
              <hr className="rcpt-rule" />
              <div className="rcpt-rows">
                {rows.map(([k, v]) => (
                  <p key={k} className="rcpt-row">
                    <span className="shrink-0">{k}</span>
                    <span className={k === "Email" ? "normal-case" : undefined}>{v}</span>
                  </p>
                ))}
              </div>
              <hr className="rcpt-rule rcpt-rule-double" />
              <div className="rcpt-rows">
                <p className="rcpt-row rcpt-total">
                  <span>Price today</span>
                  <span>Free</span>
                </p>
                <p className="rcpt-row">
                  <span>Invite</span>
                  <span className="rcpt-ok">On its way</span>
                </p>
              </div>
              <svg className="rcpt-barcode" viewBox={`0 0 ${b.reduce((a, w, i) => a + w + 1 + (i % 3), 0)} 24`} preserveAspectRatio="none" aria-hidden="true">
                {b.reduce<{ x: number; els: React.ReactNode[] }>((acc, w, i) => {
                  acc.els.push(<rect key={i} x={acc.x} y="0" width={w} height="24" />);
                  acc.x += w + 1 + (i % 3);
                  return acc;
                }, { x: 0, els: [] }).els}
              </svg>
              <p className="rcpt-dim text-center uppercase tracking-[0.1em]">Thanks for waiting</p>
              <p className="rcpt-dim text-center">Keep this, or don&apos;t. We&apos;ll email you.</p>
            </article>
          </div>
        </div>
      </div>
    );
  }

  const who = form.name.trim() || (form.email.includes("@") ? form.email.trim().split("@")[0] : "") || "You";
  return (
    <div className="wl-printer" data-state={busy ? "busy" : "idle"}>
      <form onSubmit={submit} noValidate className="wl-card wl-head relative px-5 pb-8 pt-6 sm:px-8 sm:pb-9 sm:pt-8" aria-describedby={error ? "wl-error" : undefined}>
        <p className="mb-4 flex items-center gap-2.5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--ap-ink2))]">
          <span className="wl-led" aria-hidden="true" /> {busy ? "Printing your number" : "Ticket machine"}
        </p>
        {fromGoogle && (
          <p className="mb-5 rounded-2xl bg-foreground/[0.05] px-4 py-3 text-[14px] leading-snug text-foreground/80">
            That Google account doesn&apos;t have an invite yet. Add your email below to get one.
          </p>
        )}
        <div className="wl-fields">
          <label className="wl-field">
            <span className="wl-label">First name <span className="font-normal text-[hsl(var(--ap-ink2))]">(optional)</span></span>
            <input name="name" autoComplete="given-name" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="wl-input" />
          </label>
          <label className="wl-field">
            <span className="wl-label">Email</span>
            <input
              ref={emailRef}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              maxLength={200}
              aria-invalid={badEmail || undefined}
              aria-describedby={badEmail ? "wl-error" : undefined}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="wl-input"
            />
          </label>
        </div>
        {error && (
          <p id="wl-error" role="alert" className="mt-3 text-[14px] font-medium text-destructive">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="ap-btn mt-5 w-full disabled:opacity-70">
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {busy ? "Joining…" : "Join the waitlist"}
        </button>
        <p className="mt-4 text-center text-[13px] leading-snug text-[hsl(var(--ap-ink2))]">One email when you&apos;re in. No newsletter, no spam.</p>
        <div className="wl-slot" aria-hidden="true">
          <span />
        </div>
      </form>
      {/* The next ticket waiting in the slot. It reads back who it will print for. */}
      <div className="wl-stub" aria-hidden="true">
        <div className="rcpt">
          <span>No. ???</span>
          <span>For {who}</span>
        </div>
      </div>
    </div>
  );
}
