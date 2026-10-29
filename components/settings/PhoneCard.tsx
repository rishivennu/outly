"use client";
import { useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";

type Status = { phone: string | null; verifiedAt: string | null; available: boolean };
type View = "idle" | "number" | "code";

/**
 * The WhatsApp number on the account. Adding one sends it a code first, so only a number you can read
 * messages on is ever saved. Once saved it can get sign-in codes, and the second step of two-step sign-in.
 * Hidden while WhatsApp codes are switched off, unless a number is already saved (so it can be removed).
 */
export function PhoneCard() {
  const toast = useToast();
  const [st, setSt] = useState<Status | null>(null);
  const [view, setView] = useState<View>("idle");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    api<Status>("/api/settings/phone").then(setSt).catch(() => setSt({ phone: null, verifiedAt: null, available: false }));
  }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  if (!st || (!st.available && !st.phone)) return null;

  const to = (v: View) => {
    setView(v);
    setError(null);
    if (v !== "code") setCode("");
    requestAnimationFrame(() => (v === "idle" ? headRef.current : inputRef.current)?.focus());
  };
  const run = async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      const m = e instanceof ApiError && /(\d+) seconds/.exec(e.message);
      if (m) setWait(Number(m[1]));
      setError(e instanceof ApiError ? e.message : "Something got in the way.");
      return null;
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    const r = await run(() => api<{ phone: string }>("/api/settings/phone", { method: "POST", json: { step: "send", phone } }));
    if (r) {
      setWait(60);
      to("code");
    }
  };
  const confirm = async (c = code) => {
    const r = await run(() => api<Status>("/api/settings/phone", { method: "POST", json: { step: "confirm", phone, code: c } }));
    if (r) {
      setSt(r);
      setPhone("");
      to("idle");
      toast("WhatsApp number saved.", "ok");
    }
  };
  const remove = async () => {
    const r = await run(() => api<Status>("/api/settings/phone", { method: "DELETE" }));
    if (r) {
      setSt(r);
      toast("WhatsApp number removed.", "ok");
    }
  };
  const onCode = (v: string) => {
    const d = v.replace(/\D/g, "").slice(0, 6);
    setCode(d);
    if (d.length === 6 && !busy) void confirm(d);
  };

  return (
    <section className="glass rounded-[32px] p-6 sm:p-8 lg:col-span-2" aria-labelledby="ph-h">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <MessageCircle className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <h2 id="ph-h" ref={headRef} tabIndex={-1} className="text-lg font-semibold focus:outline-none">WhatsApp number</h2>
            <p className="max-w-xl text-sm text-muted-foreground">
              {st.phone
                ? `${st.phone}. You can sign in with a code sent here, and use it as your second step if your authenticator app isn't to hand.`
                : "Add your WhatsApp number to get sign-in codes there instead of by email. We send it a code first to check it's yours."}
              {!st.available && st.phone ? " WhatsApp codes are paused right now, so email codes are used instead." : ""}
            </p>
          </div>
        </div>
        {view === "idle" && (
          <div className="flex flex-wrap gap-2">
            {st.available && <Button variant={st.phone ? "outline" : "primary"} onClick={() => to("number")}>{st.phone ? "Change number" : "Add WhatsApp number"}</Button>}
            {st.phone && <Button variant="ghost" onClick={remove} disabled={busy}>{busy ? "Removing…" : "Remove"}</Button>}
          </div>
        )}
      </div>

      {view === "number" && (
        <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <div className="max-w-xs">
            <Label htmlFor="ph-number">WhatsApp number</Label>
            <Input ref={inputRef} id="ph-number" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value.slice(0, 32))} placeholder="+91 98765 43210" required aria-describedby="ph-hint" />
            <p id="ph-hint" className="mt-2 text-xs text-muted-foreground">Indian numbers can skip the +91. Others need their country code.</p>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy || wait > 0 || phone.replace(/\D/g, "").length < 8}>{busy ? "Sending…" : wait > 0 ? `Send again in ${wait}s` : "Send code on WhatsApp"}</Button>
            <Button type="button" variant="ghost" onClick={() => to("idle")}>Cancel</Button>
          </div>
        </form>
      )}

      {view === "code" && (
        <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); void confirm(); }}>
          <p className="text-sm text-muted-foreground" role="status">A 6-digit code is on its way to {phone} on WhatsApp. It works for 10 minutes.</p>
          <div className="max-w-xs">
            <Label htmlFor="ph-code">Code from WhatsApp</Label>
            <Input ref={inputRef} id="ph-code" value={code} onChange={(e) => onCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} placeholder="000000" required className="tabular text-lg tracking-[0.2em]" />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Save number"}</Button>
            <Button type="button" variant="outline" onClick={send} disabled={busy || wait > 0}>{wait > 0 ? `Send again in ${wait}s` : "Send a new code"}</Button>
            <Button type="button" variant="ghost" onClick={() => to("number")}>Use another number</Button>
          </div>
        </form>
      )}
      {view === "idle" && error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    </section>
  );
}
