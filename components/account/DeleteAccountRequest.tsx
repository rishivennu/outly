"use client";
import { useEffect, useId, useState } from "react";
import { LogIn, Trash2 } from "lucide-react";
import { useSignedIn } from "@/components/marketing/useSignedIn";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";
import { forgetBillingCopies } from "@/lib/client/forget-billing";

/** Where the sign-in page sends the person back to once they have a session. */
export const DELETE_ACCOUNT_PATH = "/delete-account";
export const SIGN_IN_TO_DELETE = `/login?next=${encodeURIComponent(DELETE_ACCOUNT_PATH)}`;

type Me = { user: { email: string }; workspace: { ownerName: string } | null };

/**
 * R1340: the public account-deletion page's one action. Google Play asks for a web address where a person can
 * delete their account without the app; this is the same deletion Settings > Your data runs (DELETE
 * /api/settings/account, email typed out to confirm), reached from a page anyone can open. The page itself is
 * static and cacheable: this component reads the signed-in hint in the browser, then asks /api/me who is here.
 */
export function DeleteAccountRequest() {
  const id = useId();
  const signedIn = useSignedIn();
  // Starts signed out: that is what the server renders (reviewers, crawlers, most visitors), and hydration upgrades it
  // once the hint says there is a session.
  const [me, setMe] = useState<Me | null | "loading">(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) return setMe(null);
    setMe("loading");
    let live = true;
    api<Me>("/api/me")
      .then((m) => live && setMe(m))
      .catch(() => live && setMe(null));
    return () => {
      live = false;
    };
  }, [signedIn]);

  const email = me !== "loading" && me ? me.user.email : "";
  const matches = !!email && confirm.trim().toLowerCase() === email.toLowerCase();

  const remove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matches) return setError("Type the email on this account to confirm.");
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ ok: boolean; status?: string }>("/api/settings/account", { method: "DELETE", json: { confirm: confirm.trim() } });
      await forgetBillingCopies();
      window.location.href = r.status?.startsWith("/account-deleted#") ? r.status : "/";
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something got in the way. Nothing was deleted.");
      setBusy(false);
    }
  };

  // Signed out (or the session has lapsed): the only way forward is the sign-in page, which sends them back here.
  if (me === null) {
    return (
      <div className="glass rounded-[28px] p-6 sm:p-8" data-state="signed-out">
        <h2 className="text-xl font-semibold tracking-tight">Sign in to delete your account</h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
          We need to know it&rsquo;s you. Sign in with the email and password (or the Google account) you use for Outlly, and you&rsquo;ll come straight back to this page.
        </p>
        <Button asChild className="mt-5">
          <a href={SIGN_IN_TO_DELETE}>
            <LogIn className="h-4 w-4" aria-hidden="true" /> Sign in to continue
          </a>
        </Button>
      </div>
    );
  }

  if (me === "loading") {
    return (
      <div className="glass rounded-[28px] p-6 sm:p-8" role="status" aria-live="polite" data-state="loading">
        <p className="text-sm text-muted-foreground">Checking who&rsquo;s signed in…</p>
      </div>
    );
  }

  // A teammate inside someone else's studio: the server refuses (403 NOT_OWNER), so say so before they type anything.
  if (me.workspace) {
    return (
      <div className="glass rounded-[28px] p-6 sm:p-8" data-state="teammate">
        <h2 className="text-xl font-semibold tracking-tight">You&rsquo;re in {me.workspace.ownerName}&rsquo;s studio</h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Only the owner can delete a studio. To delete your own account, switch back to your own studio first, then come back to this page.
        </p>
        <Button asChild variant="outline" className="mt-5">
          <a href="/settings">Open Settings</a>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={remove} className="glass rounded-[28px] p-6 sm:p-8" aria-labelledby={`${id}-h`} data-state="owner">
      <h2 id={`${id}-h`} className="text-xl font-semibold tracking-tight">Delete the account for {email}</h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
        This removes your studio, posts, library, connected platforms and messages straight away, and signs you out everywhere. It can&rsquo;t be undone. If you want a copy first, download it from Settings before you continue.
      </p>
      <div className="mt-5 max-w-md">
        <Label htmlFor={`${id}-c`}>Type {email} to confirm</Label>
        <Input
          id={`${id}-c`}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          inputMode="email"
          aria-describedby={error ? `${id}-err` : undefined}
          aria-invalid={error ? true : undefined}
        />
        {error && (
          <p id={`${id}-err`} role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="submit" variant="danger" disabled={!matches || busy}>
          <Trash2 className="h-4 w-4" aria-hidden="true" /> {busy ? "Deleting…" : "Delete my account forever"}
        </Button>
        <Button asChild type="button" variant="ghost">
          <a href="/settings#your-data">Download my data first</a>
        </Button>
      </div>
    </form>
  );
}
