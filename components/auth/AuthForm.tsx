"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CircleCheck, Eye, EyeOff, KeyRound, Mail, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";
import { GoogleButton } from "./GoogleButton";
import { OtpBoxes, type OtpBoxesHandle } from "./OtpBoxes";
import { PhoneInput, WhatsAppAuth, WhatsAppGlyph } from "./WhatsAppAuth";
import { GoogleHelp } from "@/components/onboarding/GoogleHelp";
import { OutlyMark } from "@/components/brand/Logo";
import { MOTION_OK, gsap, useGSAP } from "@/lib/motion/gsap";
import { sameSitePath } from "@/lib/safe-next";

const AGE_ERROR = "Please confirm you're 18 or older to create an account.";

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
  age: "To create an account with Google, first tick \"I'm 18 or older\", then press Continue with Google again.",
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
 * "Forgot password?" swaps in a fourth: a reset code (email or WhatsApp) plus a new password, typed twice;
 * then back to sign in with the new one. With WhatsApp switched on (1060), "Continue with WhatsApp" opens
 * its own screen (WhatsAppAuth) that signs in, or signs up, with a code sent there.
 */
export function AuthForm({ mode, google = false, whatsapp = false, title, subtitle, banner }: { mode: "login" | "signup"; google?: boolean; whatsapp?: boolean; title: string; subtitle: string; banner?: React.ReactNode }) {
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
  const [sentTo, setSentTo] = useState<string | null>(null); // email (or wa:number) the last code went to
  // Reset codes can go to WhatsApp instead of email when the admin has it switched on.
  const [via, setVia] = useState<"email" | "whatsapp">("email");
  // Continue with WhatsApp: its own screen in place of this form.
  const [wa, setWa] = useState(false);
  const [confirmPw, setConfirmPw] = useState("");
  const [success, setSuccess] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  // Second step: the app (or a recovery code), or a code sent to the account's WhatsApp number.
  const [twoVia, setTwoVia] = useState<"app" | "whatsapp">("app");
  const [waMask, setWaMask] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [wait, setWait] = useState(0); // seconds until another code may be sent
  const [note, setNote] = useState<string | null>(null);
  // "Remember this device" (1053). Remembered: stays signed in for 14 days and, after one full two-step
  // sign-in, skips the second step here for 30. Not remembered: a session that ends with the browser.
  const [remember, setRemember] = useState(true);
  const codeRef = useRef<HTMLInputElement>(null); // the recovery-code field
  const boxesRef = useRef<OtpBoxesHandle>(null); // the six code boxes
  const focusCode = () => (codeRef.current ?? boxesRef.current)?.focus();
  const emailRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  // 1058: signing up (email or Google) needs a ticked "18 or older". The server checks it too.
  const ageRef = useRef<HTMLInputElement>(null);
  const [adult, setAdult] = useState(false);
  const askAge = () => { setError(AGE_ERROR); ageRef.current?.focus(); };
  // A reset code by WhatsApp. (Signing in by WhatsApp has its own screen, WhatsAppAuth.)
  const byPhone = via === "whatsapp" && step === "reset";
  // What the last code was sent to, so changing the email or number asks for a new one.
  const target = byPhone ? `wa:${phone.replace(/\D/g, "")}` : form.email.trim().toLowerCase();
  /** Second step on screen: ask once whether a WhatsApp code is on offer for this sign-in. */
  useEffect(() => {
    if (step !== "2fa") return;
    let live = true;
    api<{ whatsapp: string | null }>("/api/auth/2fa").then((r) => live && setWaMask(r.whatsapp)).catch(() => {});
    return () => {
      live = false;
    };
  }, [step]);
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
      if (performance.now() < 1200) gsap.fromTo(gsap.utils.selector(root)(".gs-in"), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out", stagger: 0.045, delay: 0.05 });
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
    setTwoVia("app");
    setCode("");
    setNote("Step 2 of 2. Enter the 6-digit code from your authenticator app.");
    inFlight.current = false;
    lastSent.current = null;
    setBusy(false);
    requestAnimationFrame(focusCode);
  };
  const switchTo = (s: Step) => {
    // Leaving the authenticator step: drop the halfway sign-in on the server too.
    if (step === "2fa" && s !== "2fa") void api("/api/auth/2fa", { method: "DELETE" }).catch(() => {});
    // Sign-in codes and reset codes are different codes: a code sent for one never fills the other.
    if (s === "reset" || step === "reset") setSentTo(null);
    setStep(s);
    setError(null);
    setSuccess(null);
    setConfirmPw("");
    setNote(s === "code" ? "Signing in with an email code." : s === "reset" ? "Resetting your password." : s === "password" && step !== "password" ? "Signing in with your password." : null);
    lastSent.current = null;
    setCode("");
    setRecovery(false);
    setTwoVia("app");
    if (s === "password" || s === "2fa") setVia("email"); // code <-> reset keep the channel you chose
    requestAnimationFrame(() => (s === "2fa" || (s === "code" && sentTo) ? focusCode() : emailRef.current?.focus()));
  };
  /** Email code <-> WhatsApp code, on the code step. */
  const switchVia = (v: "email" | "whatsapp") => {
    setVia(v);
    setPhone(""); // the number field starts empty again
    setError(null);
    setCode("");
    lastSent.current = null;
    setNote(v === "whatsapp" ? "Resetting with a WhatsApp code." : "Resetting with an email code.");
    requestAnimationFrame(() => (v === "whatsapp" ? phoneRef.current : emailRef.current)?.focus());
  };
  /** Second step: send a code to the account's WhatsApp number instead of using the app. */
  const sendTwoFactorWa = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ phone: string | null }>("/api/auth/2fa/whatsapp", { method: "POST" });
      setTwoVia("whatsapp");
      setRecovery(false);
      setCode("");
      setWait(60);
      lastSent.current = null;
      setNote(`A 6-digit code is on its way to ${r.phone ?? "your number"} on WhatsApp. It works for 10 minutes.`);
      setBusy(false);
      requestAnimationFrame(focusCode);
    } catch (e) {
      const m = e instanceof ApiError && /(\d+) seconds/.exec(e.message);
      if (m) setWait(Number(m[1]));
      if (e instanceof ApiError && e.code === "2FA_EXPIRED") setStep("password");
      fail(e);
    }
  };

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      if (step === "reset") await api("/api/auth/reset", { method: "POST", json: byPhone ? { step: "send", phone } : { step: "send", email: form.email } });
      else await api("/api/auth/code", { method: "POST", json: { email: form.email } });
      setSentTo(target);
      setCode("");
      if (step === "reset") {
        setForm((f) => ({ ...f, password: "" }));
        setConfirmPw("");
      }
      setWait(60);
      setNote(
        byPhone
          ? `If ${phone} is the WhatsApp number on an Outlly account, a 6-digit code is on its way there. It works for 10 minutes.`
          : `If ${form.email.trim()} has an Outlly account, a 6-digit code is on its way. It works for 10 minutes.`,
      );
      setBusy(false);
      requestAnimationFrame(focusCode);
    } catch (e) {
      const m = e instanceof ApiError && /(\d+) seconds/.exec(e.message);
      if (m) setWait(Number(m[1]));
      fail(e);
    }
  };

  const submit = async (e?: React.FormEvent, typed?: string) => {
    e?.preventDefault();
    if (busy || inFlight.current) return;
    if (mode === "signup" && !adult) return askAge();
    const c = typed ?? code;
    if (mode === "login" && (step === "code" || step === "reset") && (!sentTo || sentTo !== target)) return sendCode();
    if (step === "reset" && c.length !== 6) {
      setError("Enter all 6 digits of the code.");
      return setTries((n) => n + 1);
    }
    if (step === "reset" && form.password.length < 8) {
      setError("Choose a new password of at least 8 characters.");
      return setTries((n) => n + 1);
    }
    if (step === "reset" && form.password !== confirmPw) {
      setError("The two passwords don't match. Type the same new password in both boxes.");
      return setTries((n) => n + 1);
    }
    const sig = `${step}:${step === "2fa" ? twoVia : via}:${c}`;
    const byCode = step !== "password" && mode === "login";
    if (byCode && lastSent.current === sig) return; // this exact code is already being checked
    inFlight.current = true;
    lastSent.current = byCode ? sig : null;
    setBusy(true);
    setError(null);
    if (byCode) setNote("Checking your code…");
    try {
      if (mode === "signup") {
        await api("/api/auth/signup", { method: "POST", json: { ...form, adult, timezone: tz.current } });
        return go();
      }
      if (step === "password") return after(await api<{ twoFactor?: boolean }>("/api/auth/login", { method: "POST", json: { email: form.email, password: form.password, remember } }));
      if (step === "code") return after(await api<{ twoFactor?: boolean }>("/api/auth/code/verify", { method: "POST", json: { email: form.email, code: c, remember } }));
      if (step === "reset") {
        const r = await api<{ email: string | null }>("/api/auth/reset", { method: "POST", json: { step: "confirm", ...(byPhone ? { phone } : { email: form.email }), code: c, password: form.password } });
        // Back to sign in with the new password. Every other device was signed out. An email reset gets the
        // address back to fill in; a WhatsApp reset doesn't (a recycled number mustn't learn the old owner's email).
        setStep("password");
        setVia("email");
        setSentTo(null);
        setCode("");
        setConfirmPw("");
        setForm((f) => ({ ...f, email: r.email ?? f.email, password: "" }));
        setNote(null);
        setSuccess("Password changed. Sign in with your new password. Any other devices were signed out.");
        inFlight.current = false;
        lastSent.current = null;
        setBusy(false);
        requestAnimationFrame(() => document.getElementById(r.email ? "password" : "email")?.focus());
        return;
      }
      await api("/api/auth/2fa", { method: "POST", json: { code: c, via: twoVia, remember } });
      go();
    } catch (e) {
      // The halfway sign-in ran out: back to the start rather than a dead end.
      if (e instanceof ApiError && e.code === "2FA_EXPIRED") setStep("password");
      setNote(null);
      fail(e);
    }
  };
  /** Six digits typed or pasted: no need to hunt for the button. A reset also needs the new password, so it waits. */
  const onCodeDone = (digits: string) => {
    if (step !== "reset" && !busy && !inFlight.current) void submit(undefined, digits);
    else if (step === "reset") requestAnimationFrame(() => document.getElementById("new-password")?.focus());
  };

  const sent = (step === "code" || step === "reset") && !!sentTo && sentTo === target;
  const heading = step === "2fa" ? "One more step" : step === "reset" ? "Reset your password" : title;
  const sub =
    step === "2fa"
      ? recovery
        ? "Enter one of the recovery codes you saved when you turned on two-step sign-in. Each one works once."
        : twoVia === "whatsapp"
          ? "Enter the 6-digit code we just sent to your WhatsApp."
          : "Open your authenticator app and enter the 6-digit code it shows for Outlly."
      : step === "code"
        ? "We'll email you a 6-digit code, so there's no password to remember."
        : step === "reset"
          ? byPhone
            ? "We'll send a 6-digit code to the WhatsApp number on your account. Enter it, then choose a new password."
            : "We'll email you a 6-digit code. Enter it, then choose a new password."
          : subtitle;
  const cta = busy
    ? (step === "code" || step === "reset") && !sent ? "Sending your code…" : step === "reset" ? "Saving your password…" : mode === "login" ? "Opening Outlly…" : "Setting up your account…"
    : mode === "signup" ? "Create account" : step === "code" && !sent ? "Email me a code" : step === "reset" ? (sent ? "Save new password" : byPhone ? "Send reset code on WhatsApp" : "Email me a reset code") : step === "2fa" ? "Verify and sign in" : "Sign in";
  /** "Continue with WhatsApp": its own screen, sign in and sign up alike. */
  const useWhatsApp = () => {
    if (step === "2fa") void api("/api/auth/2fa", { method: "DELETE" }).catch(() => {});
    setStep("password");
    setError(null);
    setSuccess(null);
    setNote(null);
    setWa(true);
  };
  // The same pill as Continue with Google, so the ways in read as one set.
  const altBtn = "flex min-h-12 w-full items-center justify-center gap-3 rounded-full bg-secondary px-5 text-[15px] font-semibold text-foreground transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-px hover:bg-secondary/70 hover:shadow-[0_10px_24px_-16px_hsl(var(--foreground)/0.5)] hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:translate-y-0 active:scale-[0.985] motion-reduce:transform-none motion-reduce:transition-colors";
  const textBtn = "inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60";

  const other = mode === "login" ? "/signup" : "/login";
  const otherHref = next ? `${other}?next=${encodeURIComponent(next)}` : other;
  const label = "mb-1.5 text-[14px] font-semibold text-foreground";
  const field = "h-12 rounded-xl border border-foreground/45 bg-card shadow-[0_1px_2px_hsl(var(--foreground)/0.05)] hover:border-foreground/60 focus:border-foreground/75 focus:bg-card";

  const pwToggle = (
    <button
      type="button"
      onClick={() => setShowPw((v) => !v)}
      aria-label={showPw ? "Hide password" : "Show password"}
      aria-pressed={showPw}
      className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
    >
      {showPw ? <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" /> : <Eye className="h-[18px] w-[18px]" aria-hidden="true" />}
    </button>
  );
  // A reset doesn't sign in (you sign in with the new password next), so there's nothing to remember there.
  const remembering = mode === "login" && step !== "reset" ? <RememberChoice value={remember} onChange={setRemember} twoStep={step === "2fa"} /> : null;

  if (wa)
    return (
      // The same root as the form below, so React keeps the node (and GSAP's data-gs-ready) when switching back.
      <div ref={ref} className="gs-stage">
        <div className="mb-4 flex [@media(max-height:800px)]:hidden"><OutlyMark size={34} /></div>
        <WhatsAppAuth
          mode={mode}
          remember={remember}
          rememberSlot={remembering}
          timezone={() => tz.current}
          onSignedIn={(r) => {
            if (r.twoFactor) setWa(false);
            after(r);
          }}
          onBack={() => setWa(false)}
          onFail={() => setTries((n) => n + 1)}
          cls={{ field, label, textBtn }}
        />
      </div>
    );

  const mismatch = step === "reset" && confirmPw.length > 0 && confirmPw !== form.password;
  return (
    <div ref={ref} className="gs-stage">
      <div className="gs-in mb-4 flex [@media(max-height:800px)]:hidden"><OutlyMark size={34} /></div>
      <h1 className="gs-in font-display text-[clamp(2rem,3.4vw,2.5rem)] font-bold leading-[1.05] tracking-[-0.035em]">{heading}</h1>
      <p className="gs-in mb-6 mt-2.5 max-w-[40ch] text-[15px] leading-relaxed text-muted-foreground">{sub}</p>
      {step !== "2fa" && banner}
      {success && (
        <p role="status" className="mb-4 flex items-start gap-2.5 rounded-xl bg-lime/15 px-4 py-3 text-sm font-medium text-foreground">
          <CircleCheck className="mt-0.5 h-[18px] w-[18px] shrink-0 text-lime-ink" aria-hidden="true" />
          {success}
        </p>
      )}
      <form onSubmit={submit} className="w-full space-y-4 [@media(max-height:800px)]:space-y-3" noValidate>
        {step === "password" && (
          <p className="gs-in -mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
            Email &amp; password
          </p>
        )}
        {mode === "signup" && (
          <div className="gs-in">
            <Label htmlFor="name" className={label}>Your name</Label>
            <Input id="name" autoComplete="name" required placeholder="Alex Rivera" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
          </div>
        )}
        {byPhone && (
        <PhoneInput ref={phoneRef} id="phone" label="Your WhatsApp number" hint="The WhatsApp number on your account." onPhone={(full) => setPhone(full)} cls={{ field, label }} />
        )}
        {step !== "2fa" && !byPhone && (
        <div className="gs-in">
          <Label htmlFor="email" className={label}>Your email</Label>
          <Input ref={emailRef} id="email" type="email" inputMode="email" autoComplete="email" required placeholder="you@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={field} />
        </div>
        )}
        {step === "password" && (
        <div className="gs-in">
          {mode === "login" ? (
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <Label htmlFor="password" className={`${label} mb-0`}>Password</Label>
              <button type="button" onClick={() => switchTo("reset")} className="-my-2 -mr-1 inline-flex min-h-11 items-center rounded-lg px-1 text-[13px] font-semibold text-lime-ink underline-offset-4 transition-colors hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                Forgot password?
              </button>
            </div>
          ) : (
          <Label htmlFor="password" className={label}>
            Password
            <span id="pw-hint" className="text-xs font-normal text-muted-foreground" aria-live="polite">
              {form.password.length > 0 && form.password.length < 8 ? `${8 - form.password.length} more to go` : "At least 8 characters"}
            </span>
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
            {pwToggle}
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
            <div className="mb-2 flex items-center justify-between gap-3">
              <Label htmlFor="otp" className={`${label} mb-0`}>{step === "2fa" ? (recovery ? "Recovery code" : twoVia === "whatsapp" ? "WhatsApp code" : "Authenticator code") : byPhone ? "WhatsApp code" : "Email code"}</Label>
              {step === "2fa" && twoVia === "whatsapp" && (
                <button type="button" onClick={sendTwoFactorWa} disabled={busy || wait > 0} className={`${textBtn} tabular -my-2 -mr-3 text-xs`}>
                  {wait > 0 ? `Resend code in ${clock(wait)}` : "Resend code"}
                </button>
              )}
              {(step === "code" || step === "reset") && (
                <button type="button" onClick={sendCode} disabled={busy || wait > 0} className={`${textBtn} tabular -my-2 -mr-3 text-xs`}>
                  {wait > 0 ? `Resend code in ${clock(wait)}` : "Resend code"}
                </button>
              )}
            </div>
            {recovery ? (
              <Input
                ref={codeRef}
                id="otp"
                name="otp"
                value={code}
                onChange={(e) => setCode(e.target.value.slice(0, 20))}
                inputMode="text"
                autoComplete="one-time-code"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={20}
                placeholder="abcde-12345"
                required
                aria-invalid={error ? true : undefined}
                aria-describedby={[note ? "otp-note" : "", error ? "auth-error" : ""].filter(Boolean).join(" ") || undefined}
                className={`${field} tabular text-center text-[22px] font-semibold tracking-[0.12em]`}
              />
            ) : (
              <OtpBoxes
                ref={boxesRef}
                id="otp"
                label={step === "2fa" ? (twoVia === "whatsapp" ? "6-digit WhatsApp code" : "6-digit authenticator code") : "6-digit code"}
                value={code}
                onChange={(v) => {
                  setCode(v);
                  if (error) setError(null);
                }}
                onComplete={onCodeDone}
                disabled={busy}
                invalid={!!error}
                describedBy={[note ? "otp-note" : "", error ? "auth-error" : ""].filter(Boolean).join(" ") || undefined}
              />
            )}
          </div>
        )}
        {step === "reset" && sent && (
          <>
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
              {pwToggle}
            </div>
          </div>
          <div>
            <Label htmlFor="confirm-password" className={label}>
              Confirm new password
              {confirmPw.length > 0 && (
                <span id="cpw-hint" className={`text-xs font-normal ${mismatch ? "text-destructive" : "text-muted-foreground"}`} aria-live="polite">
                  {mismatch ? "Doesn't match yet" : "Matches"}
                </span>
              )}
            </Label>
            <Input
              id="confirm-password"
              type={showPw ? "text" : "password"}
              autoComplete="new-password"
              required
              maxLength={200}
              placeholder="Type it again"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              aria-invalid={mismatch || undefined}
              aria-describedby={confirmPw.length > 0 ? "cpw-hint" : undefined}
              className={field}
            />
          </div>
          </>
        )}
        {remembering}
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
        {mode === "signup" && (
          <label className="gs-in flex min-h-11 cursor-pointer items-start gap-3 rounded-xl px-1 py-1.5 text-[13.5px] leading-snug has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
            <input
              ref={ageRef}
              type="checkbox"
              checked={adult}
              onChange={(e) => { setAdult(e.target.checked); document.cookie = `outlly_adult=${e.target.checked ? "1; max-age=1800" : "; max-age=0"}; path=/; samesite=lax`; if (e.target.checked && (error === AGE_ERROR || error === GOOGLE_ERRORS.age)) setError(null); }}
              aria-describedby={error === AGE_ERROR ? "auth-error" : undefined}
              className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-lime-ink"
            />
            <span>I&apos;m 18 or older.</span>
          </label>
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
              <div className="flex flex-wrap justify-center gap-x-1">
                <button type="button" className={textBtn} onClick={() => { setRecovery((r) => twoVia === "whatsapp" ? false : !r); setTwoVia("app"); setCode(""); setError(null); lastSent.current = null; requestAnimationFrame(focusCode); }}>
                  <KeyRound className="h-4 w-4" aria-hidden="true" />
                  {recovery || twoVia === "whatsapp" ? "Use the app code instead" : "Use a recovery code instead"}
                </button>
                {waMask && twoVia !== "whatsapp" && (
                  <button type="button" className={textBtn} onClick={sendTwoFactorWa} disabled={busy || wait > 0}>
                    <MessageCircle className="h-4 w-4" aria-hidden="true" />
                    {wait > 0 ? `WhatsApp code in ${wait}s` : `Send a code to WhatsApp ${waMask}`}
                  </button>
                )}
              </div>
            ) : step === "reset" ? (
              <div className="flex flex-wrap justify-center gap-x-1">
                {whatsapp && (
                  <button type="button" className={textBtn} onClick={() => { setSentTo(null); switchVia(via === "whatsapp" ? "email" : "whatsapp"); }}>
                    {via === "whatsapp" ? <Mail className="h-4 w-4" aria-hidden="true" /> : <MessageCircle className="h-4 w-4" aria-hidden="true" />}
                    {via === "whatsapp" ? "Reset by email instead" : "Reset with WhatsApp instead"}
                  </button>
                )}
                <button type="button" className={textBtn} onClick={() => switchTo("password")}>
                  <KeyRound className="h-4 w-4" aria-hidden="true" />
                  Back to sign in
                </button>
              </div>
            ) : (
              <button type="button" className={textBtn} onClick={() => switchTo(step === "password" ? "code" : "password")}>
                {step !== "password" ? <KeyRound className="h-4 w-4" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
                {step === "code" ? "Use my password" : "Email me a code instead"}
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
        ) : step === "reset" ? null : (
        <>
        <div className="gs-in flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          or continue with
          <span className="h-px flex-1 bg-border" />
        </div>
        <div className="gs-in space-y-3">
          {whatsapp && (
            <button type="button" onClick={useWhatsApp} className={altBtn}>
              <WhatsAppGlyph />
              {mode === "login" ? "Continue with WhatsApp" : "Sign up with WhatsApp"}
            </button>
          )}
          <GoogleButton from={mode} next={next} remember={mode === "login" ? remember : undefined} label={mode === "login" ? "Sign in with Google" : "Sign up with Google"} onClick={mode === "signup" ? (e) => { if (!adult) { e.preventDefault(); askAge(); } } : undefined} />
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
            By creating an account, you agree to the{" "}
            <Link href="/terms" className="font-medium text-foreground underline underline-offset-4">Terms</Link> and{" "}
            <Link href="/privacy" className="font-medium text-foreground underline underline-offset-4">Privacy Policy</Link>.
          </p>
        )}
      </form>
    </div>
  );
}

/** 47 -> "0:47". */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Two plain choices rather than a lone checkbox, so "not remembered" is a decision too (1053). Native radios:
 * arrow keys move between them and screen readers announce the group.
 */
function RememberChoice({ value, onChange, twoStep }: { value: boolean; onChange: (v: boolean) => void; twoStep: boolean }) {
  const opt = (on: boolean) =>
    "flex min-h-11 flex-1 cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] font-medium transition-colors hairline has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring " +
    (on ? "bg-lime/15 text-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground");
  const dot = (on: boolean) => "grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 " + (on ? "border-lime-ink" : "border-muted-foreground/60");
  return (
    <fieldset className="gs-in">
      <legend className="sr-only">Remember this device?</legend>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className={opt(value)}>
          <input type="radio" name="remember" className="sr-only" checked={value} onChange={() => onChange(true)} aria-describedby="remember-hint" />
          <span className={dot(value)} aria-hidden="true">{value && <span className="h-1.5 w-1.5 rounded-full bg-lime-ink" />}</span>
          Remember this device
        </label>
        <label className={opt(!value)}>
          <input type="radio" name="remember" className="sr-only" checked={!value} onChange={() => onChange(false)} aria-describedby="remember-hint" />
          <span className={dot(!value)} aria-hidden="true">{!value && <span className="h-1.5 w-1.5 rounded-full bg-lime-ink" />}</span>
          Don&apos;t remember this device
        </label>
      </div>
      <p id="remember-hint" className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {value
          ? twoStep
            ? "You'll stay signed in, and this device won't ask for the second step again for 30 days. Skip it on a shared or public computer."
            : "You'll stay signed in on this device. Skip it on a shared or public computer."
          : "You'll be signed out when the browser closes, and nothing about this device is kept."}
      </p>
    </fieldset>
  );
}
