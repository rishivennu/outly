"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";

type Joined = { already: boolean; position?: number; waiting?: number };

/** Apple-style sign-up card: two fields, one black pill, then your place in line. */
export function WaitlistForm({ fromGoogle = false }: { fromGoogle?: boolean }) {
  const [form, setForm] = useState({ name: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [badEmail, setBadEmail] = useState(false);
  const [done, setDone] = useState<(Joined & { email: string; name: string | null; at: string }) | null>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return; // a double tap sends one request
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) {
      setError("Add the email you want the invite sent to.");
      setBadEmail(true);
      return;
    }
    setBusy(true);
    setError(null);
    setBadEmail(false);
    try {
      const r = await api<Joined>("/api/waitlist", { method: "POST", json: { email: form.email, name: form.name || undefined, source: fromGoogle ? "google" : "page" } });
      setDone({ ...r, email: form.email.trim().toLowerCase(), name: form.name.trim() || null, at: new Date().toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something got in the way. Try again in a moment.");
      setBadEmail(err instanceof ApiError && err.status === 400);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    // A receipt for the sign-up (1053). The place in line is the real one the server counted, and only a fresh
    // join gets it: anyone can type any address, so an address already on the list learns nothing more.
    const rows: [string, React.ReactNode][] = [
      ...(done.name ? ([["Name", done.name]] as [string, React.ReactNode][]) : []),
      ["Email", done.email],
      ...(!done.already ? ([["Joined", done.at]] as [string, React.ReactNode][]) : []),
      ["Status", done.already ? "On the list, original spot kept" : "Waiting for an invite"],
      ...(!done.already && typeof done.position === "number" && done.position > 1 ? ([["Ahead of you", (done.position - 1).toLocaleString()]] as [string, React.ReactNode][]) : []),
    ];
    return (
      <div className="wl-card wl-done wl-ticket overflow-hidden text-left" role="status">
        <div className="flex flex-col items-center px-6 pb-6 pt-9 text-center sm:px-10">
          <span className="wl-check grid h-16 w-16 place-items-center rounded-full bg-success text-white">
            <Check className="h-8 w-8" strokeWidth={3} aria-hidden="true" />
          </span>
          <p className="mt-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--ap-ink2))]">Waitlist confirmation</p>
          <h2 ref={doneRef} tabIndex={-1} className="mt-1 font-display text-[28px] font-bold tracking-[-0.02em] outline-none">
            {done.already ? "You're already on the list." : "You're on the list."}
          </h2>
          {!done.already && typeof done.position === "number" && done.position > 0 && (
            <>
              <p className="mt-4 font-display text-[64px] font-bold leading-none tracking-[-0.04em]">
                <span className="sr-only">Your place in line: </span>#{done.position.toLocaleString()}
              </p>
              <p className="mt-2 text-[14px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--ap-ink2))]">in line</p>
            </>
          )}
        </div>
        {/* The tear line of a ticket stub. */}
        <div className="mx-6 h-0 border-t-2 border-dashed border-foreground/15 sm:mx-10" aria-hidden="true" />
        <dl className="px-6 pb-2 pt-5 text-[15px] sm:px-10">
          {rows.map(([k, v], i) => (
            <div key={k} className="rcpt-row flex items-baseline justify-between gap-4 py-1.5" style={{ animationDelay: `${300 + i * 90}ms` }}>
              <dt className="shrink-0 text-[hsl(var(--ap-ink2))]">{k}</dt>
              <dd className="min-w-0 truncate text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="px-6 pb-8 pt-3 text-[14.5px] leading-relaxed text-[hsl(var(--ap-ink2))] sm:px-10">
          {done.already ? (
            <>If your invite has already gone out, look for &ldquo;Your Outlly invite is here&rdquo; in your inbox (and spam).</>
          ) : (
            <>We&apos;ll email <b className="font-semibold text-foreground">{done.email}</b> the moment your spot comes up. One email, nothing else.</>
          )}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="wl-card px-5 py-6 sm:px-8 sm:py-8" aria-describedby={error ? "wl-error" : undefined}>
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
    </form>
  );
}
