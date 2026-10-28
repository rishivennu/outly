"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, KeyRound, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";
import { GoogleButton } from "./GoogleButton";
import { GoogleHelp } from "@/components/onboarding/GoogleHelp";
import { OutlyMark } from "@/components/brand/Logo";
import { MOTION_OK, gsap, useGSAP } from "@/lib/motion/gsap";
import { sameSitePath } from "@/lib/safe-next";

const GOOGLE_ERRORS: Record<string, string> = {
  access_denied: "Google didn't let you in. While Outlly is in testing, only approved testers can use Google sign-in. See the help below.",
  denied: "Google sign-in was cancelled. Nothing was connected.",
  unverified: "That Google account doesn't have a verified email, so we can't sign you in with it.",
  state: "That sign-in took too long or came from another tab. Let's start it again.",
  exchange: "Google signed you in, but we couldn't finish the handshake. Try once more.",
  not_configured: "Google sign-in isn't set up on this server yet. Use email and password for now.",
  config: "Google refused this site's app keys (client ID or secret). An admin needs to fix them in Admin > Social platforms > YouTube.",
  redirect: "Google doesn't recognise this site's return address. An admin needs to add it under Authorised redirect URIs in Google Cloud.",
  server: "Google signed you in, but our database didn't answer. Try again in a minute.",
  maintenance: "Outlly is in a short maintenance window, so new accounts are paused. If you already have an account, sign in with the email it uses.",
};

type Step = "password" | "code" | "reset" | "2fa";

/**
 * The form half of the auth card. Apple-style utility surface: mark, one clear title, labelled fields,
 * one lime action, then Google as the alternative. Motion stays short (under half a second) and only clarifies: fields settle in on arrival,
 * and the card gives a small shake when sign-in fails.
 *
 * Sign in has three steps sharing one slot, so the card never grows: password, or an emailed 6-digit
 * code instead; then, for studios with an authenticator app, the app code (or a recovery code).
 * "Forgot password?" swaps in a fourth: an emailed reset code plus a new password, which signs you in.
 */
export function AuthForm({ mode, google = false, title, subtitle, banner }: { mode: "login" | "signup"; google?: boolean; title: string; subtitle: string; banner?: React.ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  // Only a path on this site: "/%09/evil.com" used to slip past and land people on another site after sign-in.
  const next = sameSitePath(params.get("next"));
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [caps, setCaps] = useState(false);
  const googleError = params.get("google_error");
  const [error, setError] = useState<string | null>(googleError ? (GOOGLE_ERRORS[googleError] ?? GOOGLE_ERRORS.exchange) : null);
  // Demo credentials are prefilled only when explicitly enabled (local/dev seeds).
  const demo = mode === "login" && process.env.NEXT_PUBLIC_DEMO_LOGIN === "true";
  const [form, setForm] = useState({ name: "", email: demo ? "creator@studio.dev" : mode === "signup" ? (params.get("email") ?? "").slice(0, 200) : "", password: demo ? "studio123" : "" });
  const [step, setStep] = useState<Step>(mode === "login" && params.get("step") === "2fa" ? "2fa" : "password");
  const [sentTo, setSentTo] = useState<string | null>(null); // email the last code went to
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [wait, setWait] = useState(0); // seconds until another code may be sent
  const [note, setNote] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  // State updates lag a render behind, so a paste plus Enter (or a fast double auto-submit) could send the
  // same code twice and the second answer ("already used") would hide the first. Refs see it at once.
  const inFlight = useRef(false);
  const lastSent = useRef<string | null>(null);
  // The browser's own time zone, so the first schedule and the weekly report are in local time. Google's
  // callback carries no body, so it also goes in a short-lived cookie the server reads on first sign-in.
  const tz = useRef<string | undefined>(undefined);
  useEffect(() => {
    try {
      tz.current = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
      if (tz.current) document.cookie = `outlly_tz=${tz.current}; path=/; max-age=1800; samesite=lax`;
    } catch {
      /* very old browser: the server default stays */
    }
  }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const ref = useRef<HTMLDivElement>(null);
  const { contextSafe } = useGSAP(() => {
    const root = ref.current;
    if (!root) return;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.fromTo(gsap.utils.selector(root)(".gs-in"), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out", stagger: 0.045, delay: 0.05 });
    }, root);
    root.dataset.gsReady = "1";
  }, { scope: ref });
  const shake = contextSafe(() => {
    if (!ref.current || !window.matchMedia(MOTION_OK).matches) return;
    gsap.fromTo(ref.current, { x: 0 }, { keyframes: { x: [-9, 8, -6, 4, -2, 0] }, duration: 0.45, ease: "power1.out", clearProps: "x" });
  });
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (tries) shake();
  }, [tries, shake]);

  const go = () => {
    router.replace(next ?? "/home");
    router.refresh();
  };
  const fail = (e: unknown) => {
    setError(e instanceof ApiError ? e.message : "Something got in the way. Let's try again.");
    inFlight.current = false;
    lastSent.current = null;
    setBusy(false);
    setTries((n) => n + 1);
  };
  /** First step done: in, or on to the authenticator step. */
  const after = (r: { twoFactor?: boolean }) => {
    if (!r.twoFactor) return go();
    setStep("2fa");
    setCode("");
    setNote("Step 2 of 2. Enter the 6-digit code from your authenticator app.");
    inFlight.current = false;
    lastSent.current = null;
    setBusy(false);
    requestAnimationFrame(() => codeRef.current?.focus());
  };
  const switchTo = (s: Step) => {
    // Leaving the authenticator step: drop the halfway sign-in on the server too.
    if (step === "2fa" && s !== "2fa") void api("/api/auth/2fa", { method: "DELETE" }).catch(() => {});
    // Sign-in codes and reset codes are different codes: a code sent for one never fills the other.
    if (s === "reset" || step === "reset") setSentTo(null);
    setStep(s);
    setError(null);
    setNote(s === "code" ? "Signing in with an email code." : s === "reset" ? "Resetting your password." : s === "password" && step !== "password" ? "Signing in with your password." : null);
    lastSent.current = null;
    setCode("");
    setRecovery(false);
    requestAnimationFrame(() => (s === "2fa" || (s === "code" && sentTo) ? codeRef.current : emailRef.current)?.focus());
  };

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      if (step === "reset") await api("/api/auth/reset", { method: "POST", json: { step: "send", email: form.email } });
      else await api("/api/auth/code", { method: "POST", json: { email: form.email } });
      setSentTo(form.email.trim().toLowerCase());
      setCode("");
      if (step === "reset") setForm((f) => ({ ...f, password: "" }));
      setWait(60);
      setNote(`If ${form.email.trim()} has an Outlly account, a 6-digit code is on its way. It works for 10 minutes.`);
      setBusy(false);
      requestAnimationFrame(() => codeRef.current?.focus());
    } catch (e) {
      const m = e instanceof ApiError && /(\d+) seconds/.exec(e.message);
      if (m) setWait(Number(m[1]));
      fail(e);
    }
  };

  const submit = async (e?: React.FormEvent, typed?: string) => {
    e?.preventDefault();
    if (busy || inFlight.current) return;
    const c = typed ?? code;
    if (mode === "login" && (step === "code" || step === "reset") && (!sentTo || sentTo !== form.email.trim().toLowerCase())) return sendCode();
    if (step === "reset" && form.password.length < 8) {
      setError("Choose a new password of at least 8 characters.");
      return setTries((n) => n + 1);
    }
    const sig = `${step}:${c}`;
    if (step !== "password" && mode === "login" && lastSent.current === sig) return; // this exact code is already being checked
    inFlight.current = true;
    lastSent.current = step !== "password" ? sig : null;
    setBusy(true);
    setError(null);
    if (step !== "password" && mode === "login") setNote("Checking your code…");
    try {
      if (mode === "signup") {
        await api("/api/auth/signup", { method: "POST", json: { ...form, timezone: tz.current } });
        return go();
      }
      if (step === "password") return after(await api<{ twoFactor?: boolean }>("/api/auth/login", { method: "POST", json: { email: form.email, password: form.password } }));
      if (step === "code") return after(await api<{ twoFactor?: boolean }>("/api/auth/code/verify", { method: "POST", json: { email: form.email, code: c } }));
      if (step === "reset") return after(await api<{ twoFactor?: boolean }>("/api/auth/reset", { method: "POST", json: { step: "confirm", email: form.email, code: c, password: form.password } }));
      await api("/api/auth/2fa", { method: "POST", json: { code: c } });
      go();
    } catch (e) {
      // The halfway sign-in ran out: back to the start rather than a dead end.
      if (e instanceof ApiError && e.code === "2FA_EXPIRED") setStep("password");
      setNote(null);
      fail(e);
    }
  };
  /** Six digits typed or pasted: no need to hunt for the button. */
  const onCode = (v: string) => {
    const digits = recovery ? v.slice(0, 20) : v.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    // A reset also needs the new password, so it waits for the button.
    if (!recovery && step !== "reset" && digits.length === 6 && !busy && !inFlight.current) void submit(undefined, digits);
  };

  const sent = (step === "code" || step === "reset") && !!sentTo && sentTo === form.email.trim().toLowerCase();
  const heading = step === "2fa" ? "One more step" : step === "reset" ? "Reset your password" : title;
  const sub =
    step === "2fa"
      ? recovery
        ? "Enter one of the recovery codes you saved when you turned on two-step sign-in. Each one works once."
        : "Open your authenticator app and enter the 6-digit code it shows for Outlly."
      : step === "code"
        ? "We'll email you a 6-digit code, so there's no password to remember."
        : step === "reset"
          ? "We'll email you a 6-digit code. Enter it with a new password and you're signed straight in."
          : subtitle;
  const cta = busy
    ? (step === "code" || step === "reset") && !sent ? "Sending your code…" : step === "reset" ? "Saving your password…" : mode === "login" ? "Opening Outlly…" : "Setting up your account…"
    : mode === "signup" ? "Get started" : step === "code" && !sent ? "Email me a code" : step === "reset" ? (sent ? "Save password and sign in" : "Email me a reset code") : step === "2fa" ? "Verify and sign in" : "Sign in";
  const textBtn = "inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60";

  const other = mode === "login" ? "/signup" : "/login";
  const otherHref = next ? `${other}?next=${encodeURIComponent(next)}` : other;
  const label = "mb-1.5 text-[14px] font-semibold text-foreground";
  const field = "h-12 rounded-xl border border-border bg-card shadow-[0_1px_2px_hsl(var(--foreground)/0.05)] hover:border-foreground/25 focus:border-foreground/40 focus:bg-card";

  return (
    <div ref={ref} className="gs-stage">
      <div className="gs-in mb-4 flex [@media(max-height:800px)]:hidden"><OutlyMark size={34} /></div>
      <h1 className="gs-in font-display text-[clamp(2rem,3.4vw,2.5rem)] font-bold leading-[1.05] tracking-[-0.035em]">{heading}</h1>
      <p className="gs-in mb-6 mt-2.5 max-w-[40ch] text-[15px] leading-relaxed text-muted-foreground">{sub}</p>
      {step !== "2fa" && banner}
      <form onSubmit={submit} className="w-full space-y-4 [@media(max-height:800px)]:space-y-3" noValidate>
        {mode === "signup" && (
          <div className="gs-in">
            <Label htmlFor="name" className={label}>Your name</Label>
            <Input id="name" autoComplete="name" required placeholder="Alex Rivera" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
          </div>
        )}
        {step !== "2fa" && (
        <div className="gs-in">
          <Label htmlFor="email" className={label}>Your email</Label>
          <Input ref={emailRef} id="email" type="email" inputMode="email" autoComplete="email" required placeholder="you@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={field} />
        </div>
        )}
        {(mode === "signup" || step === "password") && (
        <div className="gs-in">
          {mode === "login" && (
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <Label htmlFor="password" className={`${label} mb-0`}>Password</Label>
              <button type="button" onClick={() => switchTo("reset")} className="-my-2 -mr-1 inline-flex min-h-11 items-center rounded-lg px-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                Forgot password?
              </button>
            </div>
          )}
          {mode === "signup" && (
          <Label htmlFor="password" className={label}>
            Password
            {mode === "signup" && (
              <span id="pw-hint" className="text-xs font-normal text-muted-foreground" aria-live="polite">
                {form.password.length > 0 && form.password.length < 8 ? `${8 - form.password.length} more to go` : "At least 8 characters"}
              </span>
            )}
          </Label>
          )}
          <div className="relative">
            <Input
              id="password"
              type={showPw ? "text" : "password"}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={mode === "signup" ? 8 : 1}
              maxLength={200}
              placeholder={mode === "signup" ? "Create a password" : "Your password"}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              onKeyUp={(e) => setCaps(e.getModifierState?.("CapsLock") ?? false)}
              onBlur={() => setCaps(false)}
              aria-describedby={[mode === "signup" ? "pw-hint" : "", caps ? "pw-caps" : ""].filter(Boolean).join(" ") || undefined}
              className={`${field} pr-12`}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Hide password" : "Show password"}
              aria-pressed={showPw}
              className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {showPw ? <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" /> : <Eye className="h-[18px] w-[18px]" aria-hidden="true" />}
            </button>
          </div>
          {caps && (
            <p id="pw-caps" className="mt-2 text-xs font-medium text-warning">
              Caps Lock is on.
            </p>
          )}
        </div>
        )}
        {(sent || step === "2fa") && (
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <Label htmlFor="otp" className={`${label} mb-0`}>{step === "2fa" ? (recovery ? "Recovery code" : "Authenticator code") : "6-digit code"}</Label>
              {(step === "code" || step === "reset") && (
                <button type="button" onClick={sendCode} disabled={busy || wait > 0} className={`${textBtn} -my-2 -mr-3 text-xs`}>
                  {wait > 0 ? `Send again in ${wait}s` : "Send a new code"}
                </button>
              )}
            </div>
            <Input
              ref={codeRef}
              id="otp"
              name="otp"
              value={code}
              onChange={(e) => onCode(e.target.value)}
              inputMode={recovery ? "text" : "numeric"}
              autoComplete="one-time-code"
              autoCapitalize="none"
              spellCheck={false}
              pattern={recovery ? undefined : "[0-9]*"}
              maxLength={recovery ? 20 : 6}
              placeholder={recovery ? "abcde-12345" : "000000"}
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={[note ? "otp-note" : "", error ? "auth-error" : ""].filter(Boolean).join(" ") || undefined}
              className={`${field} tabular text-center text-[22px] font-semibold ${recovery ? "tracking-[0.12em]" : "tracking-[0.42em]"}`}
            />
          </div>
        )}
        {step === "reset" && sent && (
          <div>
            <Label htmlFor="new-password" className={label}>
              New password
              <span id="npw-hint" className="text-xs font-normal text-muted-foreground" aria-live="polite">
                {form.password.length > 0 && form.password.length < 8 ? `${8 - form.password.length} more to go` : "At least 8 characters"}
              </span>
            </Label>
            <div className="relative">
              <Input
                id="new-password"
                type={showPw ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={200}
                placeholder="Choose a new password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                aria-describedby="npw-hint"
                className={`${field} pr-12`}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Hide password" : "Show password"}
                aria-pressed={showPw}
                className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {showPw ? <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" /> : <Eye className="h-[18px] w-[18px]" aria-hidden="true" />}
              </button>
            </div>
          </div>
        )}
        {mode === "login" && (
          <p id="otp-note" role="status" className={note ? "text-sm leading-relaxed text-muted-foreground" : "sr-only"}>
            {note}
          </p>
        )}
        {error && (
          <p id="auth-error" role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="gs-in">
          <Button type="submit" variant="lime" className="auth-cta h-12 w-full text-[15px]" disabled={busy} aria-busy={busy}>
            {cta}
            {!busy && <ArrowRight className="auth-cta-arrow h-[18px] w-[18px]" aria-hidden="true" />}
          </Button>
        </div>
        {mode === "login" && (
          <div className="gs-in -my-1 flex justify-center">
            {step === "2fa" ? (
              <button type="button" className={textBtn} onClick={() => { setRecovery((r) => !r); setCode(""); setError(null); requestAnimationFrame(() => codeRef.current?.focus()); }}>
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                {recovery ? "Use the app code instead" : "Use a recovery code instead"}
              </button>
            ) : (
              <button type="button" className={textBtn} onClick={() => switchTo(step === "password" ? "code" : "password")}>
                {step !== "password" ? <KeyRound className="h-4 w-4" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
                {step === "reset" ? "Back to sign in" : step === "code" ? "Use my password instead" : "Email me a sign-in code instead"}
              </button>
            )}
          </div>
        )}
        {step === "2fa" ? (
          <p className="gs-in text-center text-sm text-muted-foreground">
            Wrong account?{" "}
            <button type="button" onClick={() => switchTo("password")} className="rounded font-semibold text-lime-ink underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
              Start over
            </button>
. Lost your phone and codes? <Link href="/help" className="rounded font-semibold text-lime-ink underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Get help</Link>.
          </p>
        ) : (
        <>
        <div className="gs-in flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          or continue with
          <span className="h-px flex-1 bg-border" />
        </div>
        <div className="gs-in space-y-3">
          <GoogleButton from={mode} next={next} label={mode === "login" ? "Sign in with Google" : "Sign up with Google"} />
          {google && <GoogleHelp compact defaultOpen={googleError === "access_denied"} />}
        </div>
        <p className="gs-in text-center text-sm text-muted-foreground">
          {mode === "login" ? "Don't have an account? " : "Already have an account? "}
          <Link href={otherHref} className="rounded font-semibold text-lime-ink underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            {mode === "login" ? "Sign up" : "Sign in"}
          </Link>
        </p>
        </>
        )}
        {mode === "signup" && (
          <p className="gs-in text-center text-xs leading-relaxed text-muted-foreground">
            By creating an account you agree to the{" "}
            <Link href="/terms" className="font-medium text-foreground underline underline-offset-4">Terms</Link> and{" "}
            <Link href="/privacy" className="font-medium text-foreground underline underline-offset-4">Privacy Policy</Link>.
          </p>
        )}
      </form>
    </div>
  );
}
