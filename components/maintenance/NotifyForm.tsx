"use client";
import { useState } from "react";
import { CheckCircle2, Mail } from "lucide-react";
import { Input } from "@/components/ui/field";

/** "Email me when it's back": one address, stored once, emailed when the admin turns maintenance off. */
export function NotifyForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setState("busy");
    const r = await fetch("/api/maintenance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }).catch(() => null);
    if (r?.ok) return setState("done");
    const j = await r?.json().catch(() => ({}));
    setErr(j?.error ?? "Couldn't save that. Try again in a moment.");
    setState("idle");
  }
  if (state === "done")
    return (
      <p role="status" className="flex items-center gap-2 rounded-2xl bg-success/10 px-4 py-3 text-[14px] text-success">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> Done. We&apos;ll email {email} the moment we&apos;re back.
      </p>
    );
  return (
    <form onSubmit={submit} className="w-full" noValidate>
      <label htmlFor="notify-email" className="mb-2 block text-left text-[13px] font-medium text-muted-foreground">Get an email when we&apos;re back</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="notify-email" type="email" required autoComplete="email" inputMode="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!err} aria-describedby={err ? "notify-err" : undefined} />
        <button type="submit" disabled={state === "busy" || !email} className="lime-bg lime-glow inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold transition-transform active:scale-[0.97] disabled:opacity-60">
          <Mail className="h-4 w-4" aria-hidden /> {state === "busy" ? "Saving..." : "Notify me"}
        </button>
      </div>
      {err && <p id="notify-err" role="alert" className="mt-2 text-left text-[13px] text-destructive">{err}</p>}
    </form>
  );
}
