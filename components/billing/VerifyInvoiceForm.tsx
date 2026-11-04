"use client";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";
import type { VerifyResult } from "@/lib/billing/invoice-verify";

/** 1121: the form on /verify-invoice. Says "matches" with the facts to compare, or that it doesn't, and nothing else. */
export function VerifyInvoiceForm(props: { number: string; code: string }) {
  const [number, setNumber] = useState(props.number);
  const [code, setCode] = useState(props.code);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<VerifyResult | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      setRes(await api<VerifyResult>("/api/invoices/verify", { method: "POST", json: { number, code } }));
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-8">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="grid gap-1.5">
          <Label htmlFor="vi-number">Invoice number</Label>
          <Input id="vi-number" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="OUT-2026-000042" autoComplete="off" spellCheck={false} required maxLength={40} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="vi-code">Verification code</Label>
          <Input id="vi-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH-JKLM" autoComplete="off" spellCheck={false} required maxLength={40} />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" variant="lime" disabled={busy || !number.trim() || !code.trim()}>
            {busy ? "Checking…" : "Check invoice"}
          </Button>
        </div>
      </form>
      <div aria-live="polite" className="mt-6">
        {err && <p className="text-sm text-destructive">{err}</p>}
        {res?.match === false && (
          <div className="flex gap-3 rounded-2xl border border-border p-4">
            <X className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
            <div>
              <p className="font-medium text-foreground">This doesn&apos;t match an Outlly invoice</p>
              <p className="mt-1 text-sm text-muted-foreground">Check the number and code against the PDF. If they are typed correctly, the document was not issued by Outlly as it stands.</p>
            </div>
          </div>
        )}
        {res?.match && (
          <div className="flex gap-3 rounded-2xl border border-border p-4">
            <Check className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="font-medium text-foreground">Genuine: Outlly issued {res.number}</p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="text-foreground">{res.amount}</dd>
                <dt className="text-muted-foreground">Issued</dt>
                <dd className="text-foreground">{res.issued}</dd>
                <dt className="text-muted-foreground">Billed to</dt>
                <dd className="text-foreground">{res.billedTo}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd className="text-foreground">{res.status}</dd>
              </dl>
              <p className="mt-3 text-sm text-muted-foreground">If the PDF shows a different amount or date, it was changed after we issued it.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
