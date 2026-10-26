"use client";
import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";

const TOPICS = ["A question", "Something is broken", "A feature idea", "Billing", "Privacy or legal"] as const;

/**
 * Contact form: becomes a support ticket (same queue as the in-app panel, admin > Support), so a reply goes
 * to the email given here. A hidden honeypot field quietly drops form-filling bots.
 */
export function ContactForm() {
  const [f, setF] = useState({ name: "", email: "", topic: TOPICS[0] as string, message: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (f.website) return setDone("received"); // bot
    if (f.message.trim().length < 10) return setErr("Tell us a little more (at least 10 characters).");
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ ref: string }>("/api/support/ticket", {
        method: "POST",
        json: { email: f.email, name: f.name || undefined, reason: "form", website: f.website || undefined, transcript: [{ role: "user", text: `[${f.topic}] ${f.message.trim()}`.slice(0, 2000) }] },
      });
      setDone(r.ref);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "That didn't send. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <div role="status" className="rounded-[1.75rem] border border-border p-7">
        <Check className="h-6 w-6 text-lime-ink dark:text-lime" aria-hidden="true" />
        <h2 className="mt-4 text-[17px] font-semibold tracking-tight">Thanks, it&apos;s with us.</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          {done === "received" ? "We'll reply by email." : `Your reference is ${done}. We'll reply to ${f.email} by email, usually within two working days.`}
        </p>
      </div>
    );

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 rounded-[1.75rem] border border-border p-7 sm:grid-cols-2" aria-labelledby="contact-form-title">
      <h2 id="contact-form-title" className="text-[17px] font-semibold tracking-tight sm:col-span-2">Send us a message</h2>
      <div>
        <Label htmlFor="cf-name">Your name (optional)</Label>
        <Input id="cf-name" autoComplete="name" maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </div>
      <div>
        <Label htmlFor="cf-email">Your email</Label>
        <Input id="cf-email" type="email" inputMode="email" autoComplete="email" required maxLength={200} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="cf-topic">What is it about?</Label>
        <select id="cf-topic" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} className="h-12 w-full rounded-2xl bg-secondary/60 px-4 text-base text-foreground hairline">
          {TOPICS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="cf-msg">Message</Label>
        <Textarea id="cf-msg" required rows={5} maxLength={1900} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder="If a post failed, include the platform, the time and the error text." />
      </div>
      {/* honeypot: hidden from people and assistive tech, bots fill it in */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="cf-website">Website</label>
        <input id="cf-website" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
      </div>
      {err && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive sm:col-span-2">
          {err}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" variant="lime" className="h-12 px-6 text-[15px]" disabled={busy} aria-busy={busy}>
          {busy ? "Sending…" : "Send message"}
          {!busy && <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />}
        </Button>
      </div>
    </form>
  );
}
