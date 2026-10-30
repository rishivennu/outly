"use client";
import { useId, useState } from "react";
import { Download, ShieldCheck, Trash2 } from "lucide-react";
import { openPrivacyNotice } from "@/components/shared/PrivacyNotice";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";
import { forgetBillingCopies } from "@/lib/client/forget-billing";

/**
 * Your data: take a copy of everything, or close the studio for good. ("Sign out everywhere" moved to
 * Settings > Security in 1053, next to the remembered devices it also clears.)
 * Deleting asks for the email typed out, which is slower than a checkbox on purpose.
 */
export function YourDataCard({ email }: { email: string }) {
  const id = useId();
  const [busy, setBusy] = useState<"delete" | null>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const matches = confirm.trim().toLowerCase() === email.toLowerCase();

  const remove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matches) return setError("Type the email on this account to confirm.");
    setBusy("delete");
    setError(null);
    try {
      const r = await api<{ ok: boolean; status?: string }>("/api/settings/account", { method: "DELETE", json: { confirm: confirm.trim() } });
      await forgetBillingCopies();
      window.location.href = r.status?.startsWith("/account-deleted#") ? r.status : "/";
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something got in the way. Nothing was deleted.");
      setBusy(null);
    }
  };

  return (
    <section id="your-data" className="glass scroll-mt-24 rounded-[32px] p-6 sm:p-8" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-2xl font-semibold tracking-tight">Your data</h2>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">It belongs to you. Take a copy whenever you like.</p>
      <Button type="button" variant="outline" className="mt-4" onClick={openPrivacyNotice}>
        <ShieldCheck className="h-4 w-4" aria-hidden="true" /> How we handle your data
      </Button>

      <div className="mt-6 grid gap-3">
        <div className="flex flex-col justify-between gap-3 rounded-3xl bg-secondary/50 p-5 hairline">
          <div>
            <h3 className="font-semibold">Download my data</h3>
            <p className="mt-1 text-sm text-muted-foreground">Your profile, posts, schedule, uploads, messages and invoices in one PDF that's easy to read. Passwords and access tokens are never included.</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button asChild variant="outline">
              <a href="/api/settings/export" download>
                <Download className="h-4 w-4" aria-hidden="true" /> Download PDF
              </a>
            </Button>
            <a href="/api/settings/export?format=json" download className="inline-flex min-h-11 items-center text-sm font-medium text-foreground/80 underline underline-offset-4 hover:text-foreground">
              Or as JSON, for moving to another app
            </a>
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-3xl p-5 hairline">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Delete account</h3>
            <p className="mt-1 text-sm text-muted-foreground">Removes your studio, posts, library and connections. This can&apos;t be undone. Invoices are kept until 8 years after their date, as tax law requires, then deleted.</p>
          </div>
          {!open && (
            <Button variant="danger" onClick={() => setOpen(true)} aria-expanded={false} aria-controls={`${id}-del`}>
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete account
            </Button>
          )}
        </div>
        {open && (
          <form id={`${id}-del`} onSubmit={remove} className="mt-4 max-w-md">
            <Label htmlFor={`${id}-c`}>Type {email} to confirm</Label>
            <Input
              id={`${id}-c`}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              aria-describedby={error ? `${id}-err` : undefined}
              aria-invalid={error ? true : undefined}
            />
            {error && (
              <p id={`${id}-err`} role="alert" className="mt-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="submit" variant="danger" disabled={!matches || busy !== null}>
                {busy === "delete" ? "Deleting…" : "Delete forever"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => { setOpen(false); setConfirm(""); setError(null); }} disabled={busy === "delete"}>
                Keep my account
              </Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
