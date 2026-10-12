"use client";
import { useState } from "react";
import { CheckCircle2, Copy, CreditCard, FlaskConical, KeyRound, Mail, Send, ShieldAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Pill } from "./ui";

export type Secret = { set: boolean; last4: string };
type Pay = {
  provider: "mock" | "stripe" | "razorpay" | "paypal";
  mode: "test" | "live";
  stripe: { publishableKey: string; secretKey: Secret; webhookSecret: Secret };
  razorpay: { keyId: string; keySecret: Secret; webhookSecret: Secret };
  paypal: { clientId: string; clientSecret: Secret; webhookId: string };
  business: { name: string; address: string; gstin: string; taxPercent: number };
};
type Mailer = { provider: "mock" | "resend"; from: string; replyTo: string; resend: { apiKey: Secret } };
/** undefined = keep, "" = keep, string = replace, null = remove */
export type SecretEdit = string | null | undefined;

export function SecretField({ id, label, saved, value, onChange, placeholder }: { id: string; label: string; saved: Secret; value: SecretEdit; onChange: (v: SecretEdit) => void; placeholder: string }) {
  const editing = value !== undefined;
  return (
    <div>
      <Label htmlFor={id}>
        {label}
        {saved.set && value !== null && <span className="flex items-center gap-1 text-[11.5px] text-success"><KeyRound className="h-3 w-3" aria-hidden />saved ···· {saved.last4}</span>}
      </Label>
      {editing && value !== null ? (
        <div className="flex gap-2">
          <Input id={id} type="password" autoComplete="off" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="font-mono text-[14px]" autoFocus />
          <Button type="button" variant="ghost" size="sm" className="h-12" onClick={() => onChange(undefined)}>Cancel</Button>
        </div>
      ) : (
        <div className="flex h-12 items-center gap-2 rounded-2xl bg-secondary/40 px-4 text-[13.5px] hairline">
          <span className="flex-1 font-mono text-muted-foreground">{value === null ? "Will be removed on save" : saved.set ? `•••••••••••• ${saved.last4}` : "Not set"}</span>
          <button type="button" onClick={() => onChange("")} className="rounded-full px-2.5 py-1 text-[12.5px] font-semibold hover:bg-secondary">{saved.set ? "Replace" : "Add"}</button>
          {saved.set && value !== null && <button type="button" onClick={() => onChange(null)} className="rounded-full px-2.5 py-1 text-[12.5px] text-destructive hover:bg-destructive/10">Remove</button>}
          {value === null && <button type="button" onClick={() => onChange(undefined)} className="rounded-full px-2.5 py-1 text-[12.5px] hover:bg-secondary">Undo</button>}
        </div>
      )}
    </div>
  );
}

function Choice<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; label: string; options: { value: T; title: string; body: string; badge?: string }[] }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("grid gap-2.5", options.length > 3 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3")}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)} className={cn("relative rounded-[20px] p-4 text-left transition-all duration-300 hairline", on ? "bg-lime/[0.08] ring-2 ring-lime" : "hover:bg-secondary/50")}>
            <span className="flex items-center justify-between gap-2">
              <span className="font-display text-[15px] font-semibold">{o.title}</span>
              {o.badge && <Pill tone={on ? "lime" : "muted"}>{o.badge}</Pill>}
            </span>
            <span className="mt-1 block text-[12.5px] leading-snug text-muted-foreground">{o.body}</span>
          </button>
        );
      })}
    </div>
  );
}

function Result({ r }: { r: { ok: boolean; message: string } | null }) {
  return (
    <div className="liquid-panel" data-open={!!r}>
      <div>
        <p role="status" className={cn("liquid-inner mt-4 flex items-start gap-2 rounded-2xl px-4 py-3 text-[13.5px]", r?.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
          {r?.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          <span>{r?.message}</span>
        </p>
      </div>
    </div>
  );
}

export function CopyRow({ label, value }: { label: string; value: string }) {
  const toast = useToast();
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-secondary/40 px-3 py-2 hairline">
      <span className="shrink-0 text-[12px] font-semibold text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate text-[12.5px]">{value}</code>
      <button type="button" aria-label={`Copy ${label} webhook URL`} onClick={() => navigator.clipboard.writeText(value).then(() => toast("Copied"))} className="grid h-8 w-8 place-items-center rounded-full hover:bg-secondary"><Copy className="h-3.5 w-3.5" /></button>
    </div>
  );
}

export function IntegrationsForm({ payments, email, webhooks }: { payments: Pay; email: Mailer; webhooks: { stripe: string; razorpay: string; paypal: string } }) {
  const toast = useToast();
  // ---- payments
  const [pay, setPay] = useState(payments);
  const [p, setP] = useState({ provider: payments.provider, mode: payments.mode, stripePk: payments.stripe.publishableKey, rzpId: payments.razorpay.keyId, ppId: payments.paypal.clientId, ppHook: payments.paypal.webhookId, business: payments.business });
  const [ps, setPs] = useState<Record<string, SecretEdit>>({});
  const [pBusy, setPBusy] = useState<"save" | "test" | null>(null);
  const [pRes, setPRes] = useState<{ ok: boolean; message: string } | null>(null);
  // ---- email
  const [mail, setMail] = useState(email);
  const [m, setM] = useState({ provider: email.provider, from: email.from, replyTo: email.replyTo });
  const [ms, setMs] = useState<SecretEdit>(undefined);
  const [to, setTo] = useState("");
  const [mBusy, setMBusy] = useState<"save" | "test" | null>(null);
  const [mRes, setMRes] = useState<{ ok: boolean; message: string } | null>(null);

  const sec = (k: string) => (ps[k] === undefined || ps[k] === "" ? undefined : ps[k]);
  const pDirty = JSON.stringify({ provider: pay.provider, mode: pay.mode, stripePk: pay.stripe.publishableKey, rzpId: pay.razorpay.keyId, ppId: pay.paypal.clientId, ppHook: pay.paypal.webhookId, business: pay.business }) !== JSON.stringify(p) || Object.values(ps).some((v) => v !== undefined && v !== "");
  const mDirty = JSON.stringify({ provider: mail.provider, from: mail.from, replyTo: mail.replyTo }) !== JSON.stringify(m) || (ms !== undefined && ms !== "");

  const missing =
    p.provider === "stripe" ? !(pay.stripe.secretKey.set || sec("stripe.secretKey")) || ps["stripe.secretKey"] === null
    : p.provider === "razorpay" ? !p.rzpId || !(pay.razorpay.keySecret.set || sec("razorpay.keySecret")) || ps["razorpay.keySecret"] === null
    : p.provider === "paypal" ? !p.ppId || !(pay.paypal.clientSecret.set || sec("paypal.clientSecret")) || ps["paypal.clientSecret"] === null
    : false;

  async function savePay() {
    setPBusy("save");
    setPRes(null);
    try {
      const r = await adminApi<{ payments: Pay }>("/api/admin/integrations", {
        method: "PUT",
        json: {
          key: "payments",
          patch: {
            provider: p.provider,
            mode: p.mode,
            stripe: { publishableKey: p.stripePk, secretKey: sec("stripe.secretKey"), webhookSecret: sec("stripe.webhookSecret") },
            razorpay: { keyId: p.rzpId, keySecret: sec("razorpay.keySecret"), webhookSecret: sec("razorpay.webhookSecret") },
            paypal: { clientId: p.ppId, clientSecret: sec("paypal.clientSecret"), webhookId: p.ppHook },
            business: { ...p.business, taxPercent: Number(p.business.taxPercent) || 0 },
          },
        },
      });
      setPay(r.payments);
      setPs({});
      toast(missing ? "Saved. Checkout stays on Mock until the keys are added." : `Saved. Checkout now uses ${p.provider === "mock" ? "Mock" : p.provider}.`);
    } catch (e: any) {
      setPRes({ ok: false, message: e.message });
    } finally {
      setPBusy(null);
    }
  }
  async function testPay() {
    setPBusy("test");
    try {
      setPRes(await adminApi("/api/admin/integrations/test", { method: "POST", json: { key: "payments" } }));
    } catch (e: any) {
      setPRes({ ok: false, message: e.message });
    } finally {
      setPBusy(null);
    }
  }
  async function saveMail() {
    setMBusy("save");
    setMRes(null);
    try {
      const r = await adminApi<{ email: Mailer }>("/api/admin/integrations", { method: "PUT", json: { key: "email", patch: { ...m, resend: { apiKey: ms === "" ? undefined : ms } } } });
      setMail(r.email);
      setMs(undefined);
      toast("Email settings saved");
    } catch (e: any) {
      setMRes({ ok: false, message: e.message });
    } finally {
      setMBusy(null);
    }
  }
  async function testMail() {
    if (!/^\S+@\S+\.\S+$/.test(to)) return setMRes({ ok: false, message: "Enter the address to send the test to." });
    setMBusy("test");
    try {
      setMRes(await adminApi("/api/admin/integrations/test", { method: "POST", json: { key: "email", to } }));
    } catch (e: any) {
      setMRes({ ok: false, message: e.message });
    } finally {
      setMBusy(null);
    }
  }

  const biz = (k: keyof Pay["business"], v: string) => setP((x) => ({ ...x, business: { ...x.business, [k]: k === "taxPercent" ? (v as any) : v } }));

  return (
    <div className="grid gap-5">
      <Card>
        <CardTitle hint="Where customers pay. Switching takes effect on the next checkout." action={<Pill tone={pay.provider === "mock" ? "info" : pay.mode === "live" ? "ok" : "warn"}>{pay.provider === "mock" ? "Mock active" : `${pay.provider} · ${pay.mode}`}</Pill>}>
          <span className="inline-flex items-center gap-2"><CreditCard className="h-4 w-4" aria-hidden />Payment gateway</span>
        </CardTitle>
        <Choice
          label="Payment gateway"
          value={p.provider}
          onChange={(v) => setP((x) => ({ ...x, provider: v }))}
          options={[
            { value: "mock", title: "Mock", body: "Fake checkout with test cards and UPI. Nothing is charged.", badge: "testing" },
            { value: "stripe", title: "Stripe", body: "Cards, wallets, global currencies. Hosted Checkout.", badge: "global" },
            { value: "razorpay", title: "Razorpay", body: "UPI, cards, netbanking in India. Popup checkout.", badge: "India" },
            { value: "paypal", title: "PayPal", body: "PayPal balance and cards in 200+ countries. Redirect checkout.", badge: "global" },
          ]}
        />

        <div className={cn("liquid-panel", "mt-1")} data-open={p.provider !== "mock"}>
          <div>
            <div className="liquid-inner grid gap-4 pt-5">
              <div className="flex flex-wrap items-center gap-3">
                <div role="radiogroup" aria-label="Mode" className="inline-flex rounded-full bg-secondary/60 p-1 hairline">
                  {(["test", "live"] as const).map((v) => (
                    <button key={v} type="button" role="radio" aria-checked={p.mode === v} onClick={() => setP((x) => ({ ...x, mode: v }))} className={cn("h-9 rounded-full px-4 text-[13px] font-semibold capitalize transition-all", p.mode === v ? (v === "live" ? "bg-success text-white" : "lime-bg") : "text-muted-foreground")}>
                      {v} mode
                    </button>
                  ))}
                </div>
                {p.mode === "live" && <span className="flex items-center gap-1.5 text-[12.5px] text-warning"><ShieldAlert className="h-4 w-4" aria-hidden />Real money. Use live keys and test one payment yourself first.</span>}
              </div>

              {p.provider === "stripe" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label htmlFor="st-pk">Publishable key</Label>
                    <Input id="st-pk" value={p.stripePk} onChange={(e) => setP((x) => ({ ...x, stripePk: e.target.value.trim() }))} placeholder={p.mode === "live" ? "pk_live_…" : "pk_test_…"} className="font-mono text-[14px]" />
                  </div>
                  <SecretField id="st-sk" label="Secret key" saved={pay.stripe.secretKey} value={ps["stripe.secretKey"]} onChange={(v) => setPs((x) => ({ ...x, "stripe.secretKey": v }))} placeholder={p.mode === "live" ? "sk_live_…" : "sk_test_…"} />
                  <SecretField id="st-wh" label="Webhook signing secret" saved={pay.stripe.webhookSecret} value={ps["stripe.webhookSecret"]} onChange={(v) => setPs((x) => ({ ...x, "stripe.webhookSecret": v }))} placeholder="whsec_…" />
                  <div className="sm:col-span-2">
                    <p className="mb-2 text-[12.5px] text-muted-foreground">In Stripe → Developers → Webhooks, add this endpoint with <code>checkout.session.completed</code> and <code>checkout.session.expired</code>:</p>
                    <CopyRow label="Stripe" value={webhooks.stripe} />
                  </div>
                </div>
              )}
              {p.provider === "razorpay" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label htmlFor="rz-id">Key id</Label>
                    <Input id="rz-id" value={p.rzpId} onChange={(e) => setP((x) => ({ ...x, rzpId: e.target.value.trim() }))} placeholder={p.mode === "live" ? "rzp_live_…" : "rzp_test_…"} className="font-mono text-[14px]" />
                  </div>
                  <SecretField id="rz-sk" label="Key secret" saved={pay.razorpay.keySecret} value={ps["razorpay.keySecret"]} onChange={(v) => setPs((x) => ({ ...x, "razorpay.keySecret": v }))} placeholder="secret" />
                  <SecretField id="rz-wh" label="Webhook secret" saved={pay.razorpay.webhookSecret} value={ps["razorpay.webhookSecret"]} onChange={(v) => setPs((x) => ({ ...x, "razorpay.webhookSecret": v }))} placeholder="the secret you typed in Razorpay" />
                  <div className="sm:col-span-2">
                    <p className="mb-2 text-[12.5px] text-muted-foreground">In Razorpay → Settings → Webhooks, add this URL with <code>order.paid</code> and <code>payment.failed</code>:</p>
                    <CopyRow label="Razorpay" value={webhooks.razorpay} />
                  </div>
                </div>
              )}
              {p.provider === "paypal" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label htmlFor="pp-id">Client id</Label>
                    <Input id="pp-id" value={p.ppId} onChange={(e) => setP((x) => ({ ...x, ppId: e.target.value.trim() }))} placeholder={p.mode === "live" ? "Live app client id" : "Sandbox app client id"} className="font-mono text-[14px]" />
                  </div>
                  <SecretField id="pp-sk" label="Client secret" saved={pay.paypal.clientSecret} value={ps["paypal.clientSecret"]} onChange={(v) => setPs((x) => ({ ...x, "paypal.clientSecret": v }))} placeholder="secret" />
                  <div>
                    <Label htmlFor="pp-wh">Webhook id</Label>
                    <Input id="pp-wh" value={p.ppHook} onChange={(e) => setP((x) => ({ ...x, ppHook: e.target.value.trim() }))} placeholder="e.g. 8PT597110X687430LKGECATA" className="font-mono text-[14px]" />
                  </div>
                  <div className="sm:col-span-2">
                    <p className="mb-2 text-[12.5px] text-muted-foreground">In PayPal Developer → Apps → your app → Webhooks, add this URL with <code>CHECKOUT.ORDER.APPROVED</code>, <code>PAYMENT.CAPTURE.COMPLETED</code> and <code>PAYMENT.CAPTURE.DENIED</code>, then paste its webhook id above. Sandbox and live are separate apps; match the mode. Cards are charged in USD, EUR, GBP, CAD, AUD or SGD (others fall back to USD).</p>
                    <CopyRow label="PayPal" value={webhooks.paypal} />
                  </div>
                </div>
              )}
              {missing && <p className="rounded-2xl bg-warning/10 px-4 py-3 text-[13px] text-warning">Keys missing. You can save, but checkout keeps using Mock until they're added, so customers are never stuck.</p>}
            </div>
          </div>
        </div>

        <details className="group mt-5 rounded-[20px] hairline">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[14px] font-medium [&::-webkit-details-marker]:hidden">
            Invoice details (business name, address, GSTIN, tax)
            <span className="text-muted-foreground transition-transform group-open:rotate-45" aria-hidden>+</span>
          </summary>
          <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2">
            <div><Label htmlFor="bz-n">Business name</Label><Input id="bz-n" value={p.business.name} onChange={(e) => biz("name", e.target.value)} /></div>
            <div><Label htmlFor="bz-g">GSTIN (optional)</Label><Input id="bz-g" value={p.business.gstin} onChange={(e) => biz("gstin", e.target.value.toUpperCase())} className="font-mono" /></div>
            <div className="sm:col-span-2"><Label htmlFor="bz-a">Address</Label><Input id="bz-a" value={p.business.address} onChange={(e) => biz("address", e.target.value)} /></div>
            <div><Label htmlFor="bz-t">Tax % shown on invoices (inclusive)</Label><Input id="bz-t" inputMode="decimal" value={String(p.business.taxPercent)} onChange={(e) => biz("taxPercent", e.target.value.replace(/[^\d.]/g, ""))} /></div>
          </div>
        </details>

        <Result r={pRes} />
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="lime" onClick={savePay} disabled={!pDirty || !!pBusy}>{pBusy === "save" ? "Saving…" : "Save payments"}</Button>
          <Button variant="outline" onClick={testPay} disabled={!!pBusy || pDirty} title={pDirty ? "Save first, the test uses saved keys" : undefined}>
            <FlaskConical className="h-4 w-4" aria-hidden />{pBusy === "test" ? "Testing…" : "Test connection"}
          </Button>
          {pDirty && <span className="self-center text-[12.5px] text-muted-foreground">Unsaved changes</span>}
        </div>
      </Card>

      <Card>
        <CardTitle hint="Invoices, ticket confirmations and replies go out through this." action={<Pill tone={mail.provider === "mock" ? "info" : "ok"}>{mail.provider === "mock" ? "Mock: outbox only" : "Resend live"}</Pill>}>
          <span className="inline-flex items-center gap-2"><Mail className="h-4 w-4" aria-hidden />Email</span>
        </CardTitle>
        <Choice
          label="Email provider"
          value={m.provider}
          onChange={(v) => setM((x) => ({ ...x, provider: v }))}
          options={[
            { value: "mock", title: "Mock", body: "Emails are saved to the Outbox so you can read them. Nothing is sent.", badge: "testing" },
            { value: "resend", title: "Resend", body: "Real delivery with your verified domain. Free tier is 3,000 a month.", badge: "live" },
          ]}
        />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="em-f">From</Label><Input id="em-f" value={m.from} onChange={(e) => setM((x) => ({ ...x, from: e.target.value }))} placeholder="Outlly <hello@yourdomain.com>" /></div>
          <div><Label htmlFor="em-r">Reply-to (optional)</Label><Input id="em-r" type="email" value={m.replyTo} onChange={(e) => setM((x) => ({ ...x, replyTo: e.target.value }))} placeholder="support@yourdomain.com" /></div>
          <div className={cn("liquid-panel sm:col-span-2")} data-open={m.provider === "resend"}>
            <div><div className="liquid-inner"><SecretField id="em-k" label="Resend API key" saved={mail.resend.apiKey} value={ms} onChange={setMs} placeholder="re_…" /></div></div>
          </div>
        </div>
        <Result r={mRes} />
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button variant="lime" onClick={saveMail} disabled={!mDirty || !!mBusy}>{mBusy === "save" ? "Saving…" : "Save email"}</Button>
          <div className="flex min-w-[260px] flex-1 gap-2 sm:max-w-md">
            <Input type="email" aria-label="Send a test email to" placeholder="you@company.com" value={to} onChange={(e) => setTo(e.target.value)} className="h-11" />
            <Button variant="outline" onClick={testMail} disabled={!!mBusy || mDirty} title={mDirty ? "Save first" : undefined}><Send className="h-4 w-4" aria-hidden />{mBusy === "test" ? "Sending…" : "Send test"}</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
