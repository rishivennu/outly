"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";
import { GoogleButton } from "./GoogleButton";
import { GoogleHelp } from "@/components/onboarding/GoogleHelp";

const GOOGLE_ERRORS: Record<string, string> = {
  access_denied: "Google didn't let you in. While Outlly is in testing, only approved testers can use Google sign-in. See the help below.",
  denied: "Google sign-in was cancelled. Nothing was connected.",
  unverified: "That Google account doesn't have a verified email, so we can't sign you in with it.",
  state: "That sign-in took too long or came from another tab. Let's start it again.",
  exchange: "Google signed you in, but we couldn't finish the handshake. Try once more.",
  not_configured: "Google sign-in isn't set up on this server yet. Use email and password for now.",
};

export function AuthForm({ mode, google = false }: { mode: "login" | "signup"; google?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const [busy, setBusy] = useState(false);
  const googleError = params.get("google_error");
  const [error, setError] = useState<string | null>(googleError ? (GOOGLE_ERRORS[googleError] ?? GOOGLE_ERRORS.exchange) : null);
  // Demo credentials are prefilled only when explicitly enabled (local/dev seeds).
  const demo = mode === "login" && process.env.NEXT_PUBLIC_DEMO_LOGIN === "true";
  const [form, setForm] = useState({ name: "", email: demo ? "creator@studio.dev" : mode === "signup" ? (params.get("email") ?? "").slice(0, 200) : "", password: demo ? "studio123" : "" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/auth/${mode}`, { method: "POST", json: mode === "login" ? { email: form.email, password: form.password } : form });
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/home");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something got in the way. Let's try again.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="w-full space-y-5" noValidate>
      {google && (
        <div className="space-y-3">
          <GoogleButton from={mode} next={next} />
          <p className="text-center text-xs text-muted-foreground">Signs you in and links your YouTube channel in one step.</p>
          <GoogleHelp compact defaultOpen={googleError === "access_denied"} />
          <div className="flex items-center gap-3 pt-1 text-xs text-muted-foreground" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            or use email
            <span className="h-px flex-1 bg-border" />
          </div>
        </div>
      )}
      {mode === "signup" && (
        <div>
          <Label htmlFor="name">What should we call you?</Label>
          <Input id="name" autoComplete="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
      )}
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" inputMode="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "signup" ? 8 : 1} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} aria-describedby={mode === "signup" ? "pw-hint" : undefined} />
        {mode === "signup" && (
          <p id="pw-hint" className="mt-2 text-xs text-muted-foreground">
            At least 8 characters.
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" variant="lime" size="lg" className="w-full" disabled={busy}>
        {busy ? (mode === "login" ? "Opening Outlly…" : "Setting up your account…") : mode === "login" ? "Let's go" : "Create my account"}
        {!busy && <ArrowRight className="h-5 w-5" />}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {mode === "login" ? (
          <>
            New here?{" "}
            <Link href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"} className="font-medium text-foreground underline underline-offset-4">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have one?{" "}
            <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="font-medium text-foreground underline underline-offset-4">
              Sign in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
