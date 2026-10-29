"use client";
import { useState } from "react";
import { CheckCircle2, MessageCircle, Send, Wifi, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import { Card, CardTitle, Pill } from "./ui";
import { SecretField, type Secret, type SecretEdit } from "./IntegrationsForm";

export type WhatsAppView = { enabled: boolean; phoneNumberId: string; wabaId: string; token: Secret; template: string; lang: string };
type Result = { ok: boolean; message: string } | null;

/**
 * WhatsApp sign-in codes (Meta Cloud API). Off by default. The switch only turns on once the ID, token and
 * template are in, and "Check connection" proves the ID and token without messaging anyone.
 */
export function WhatsAppCard({ initial }: { initial: WhatsAppView }) {
  const toast = useToast();
  const [saved, setSaved] = useState(initial);
  const [f, setF] = useState({ phoneNumberId: initial.phoneNumberId, wabaId: initial.wabaId, template: initial.template, lang: initial.lang });
  const [token, setToken] = useState<SecretEdit>(undefined);
  const [busy, setBusy] = useState<null | "save" | "check" | "send" | "toggle">(null);
  const [res, setRes] = useState<Result>(null);
  const [to, setTo] = useState("");

  const hasToken = (saved.token.set && token !== null) || !!token;
  const complete = !!(f.phoneNumberId && f.template && hasToken);

  async function save(enabled = saved.enabled, why: "save" | "toggle" = "save") {
    setBusy(why);
    setRes(null);
    try {
      const r = await adminApi<{ whatsapp: WhatsAppView }>("/api/admin/integrations", { method: "PUT", json: { key: "whatsapp", patch: { ...f, enabled, token: token === "" ? undefined : token } } });
      setSaved(r.whatsapp);
      setToken(undefined);
      toast(why === "toggle" ? (enabled ? "WhatsApp codes are on" : "WhatsApp codes are off") : "WhatsApp settings saved");
    } catch (e: any) {
      setRes({ ok: false, message: e.message });
    } finally {
      setBusy(null);
    }
  }
  async function test(send: boolean) {
    if (send && to.replace(/\D/g, "").length < 8) return setRes({ ok: false, message: "Enter the WhatsApp number to send the sample to." });
    setBusy(send ? "send" : "check");
    setRes(null);
    try {
      setRes(await adminApi("/api/admin/integrations/test", { method: "POST", json: { key: "whatsapp", ...(send ? { to } : {}) } }));
    } catch (e: any) {
      setRes({ ok: false, message: e.message });
    } finally {
      setBusy(null);
    }
  }
  const field = (k: keyof typeof f, label: string, placeholder: string, hint?: string) => (
    <div>
      <Label htmlFor={`wa-${k}`}>{label}</Label>
      <Input id={`wa-${k}`} value={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} placeholder={placeholder} spellCheck={false} autoComplete="off" className="font-mono text-[14px]" aria-describedby={hint ? `wa-${k}-hint` : undefined} />
      {hint && <p id={`wa-${k}-hint`} className="mt-1.5 text-[12.5px] text-muted-foreground">{hint}</p>}
    </div>
  );

  return (
    <Card>
      <CardTitle
        hint="Sign-in codes on WhatsApp, next to the email ones. Members can add a number in Settings, then use it to sign in or as their second step."
        action={<Pill tone={saved.enabled ? "ok" : "muted"}>{saved.enabled ? "On" : "Off"}</Pill>}
      >
        <span className="inline-flex items-center gap-2"><MessageCircle className="h-4 w-4" aria-hidden />WhatsApp codes</span>
      </CardTitle>

      <div className="grid gap-4 md:grid-cols-2">
        {field("phoneNumberId", "Phone number ID", "1234567890123456", "WhatsApp Manager > Phone numbers, or API Setup. Digits only, not the number itself.")}
        {field("wabaId", "WhatsApp Business Account ID", "1234567890123456", "Kept for reference and template checks.")}
        <div className="md:col-span-2">
          <SecretField id="wa-token" label="Access token (system user)" saved={saved.token} value={token} onChange={setToken} placeholder="EAAG…" />
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">A permanent system-user token with whatsapp_business_messaging. Temporary tokens from API Setup stop working after 24 hours.</p>
        </div>
        {field("template", "Template name", "outlly_code", "An approved Authentication template with a copy-code button.")}
        {field("lang", "Template language", "en", "Exactly as approved, like en or en_US.")}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button type="button" variant="primary" onClick={() => save()} disabled={!!busy}>{busy === "save" ? "Saving…" : "Save"}</Button>
        <Button type="button" variant="outline" onClick={() => test(false)} disabled={!!busy || !saved.token.set || !saved.phoneNumberId}>
          <Wifi className="h-4 w-4" aria-hidden /> {busy === "check" ? "Checking…" : "Check connection"}
        </Button>
        <Button
          type="button"
          variant={saved.enabled ? "ghost" : "lime"}
          onClick={() => save(!saved.enabled, "toggle")}
          disabled={!!busy || (!saved.enabled && !complete)}
          title={!saved.enabled && !complete ? "Add the Phone number ID, token and template first" : undefined}
        >
          {busy === "toggle" ? "Saving…" : saved.enabled ? "Switch off" : "Switch on"}
        </Button>
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
          <Label htmlFor="wa-to">Send a sample code to</Label>
          <Input id="wa-to" type="tel" inputMode="tel" autoComplete="off" value={to} onChange={(e) => setTo(e.target.value)} placeholder="+91 98765 43210" />
        </div>
        <Button type="button" variant="outline" className="h-12" onClick={() => test(true)} disabled={!!busy || !saved.token.set || !saved.phoneNumberId}>
          <Send className="h-4 w-4" aria-hidden /> {busy === "send" ? "Sending…" : "Send sample"}
        </Button>
      </div>
      <p className="mt-1.5 text-[12.5px] text-muted-foreground">Uses the saved settings, even while switched off. The sample code doesn't work anywhere.</p>

      {res && (
        <p role={res.ok ? "status" : "alert"} className={`mt-4 flex items-start gap-2 rounded-2xl px-4 py-3 text-[13.5px] ${res.ok ? "bg-success/10" : "bg-destructive/10 text-destructive"}`}>
          {res.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          <span>{res.message}</span>
        </p>
      )}
    </Card>
  );
}
