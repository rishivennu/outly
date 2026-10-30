"use client";
import { forwardRef, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";
import { OtpBoxes, type OtpBoxesHandle } from "./OtpBoxes";

/** Country codes for the number field. India first and preselected; the rest are where Outlly creators are. */
const COUNTRIES: { iso: string; name: string; cc: string }[] = [
  { iso: "IN", name: "India", cc: "91" },
  { iso: "US", name: "United States", cc: "1" },
  { iso: "CA", name: "Canada", cc: "1" },
  { iso: "GB", name: "United Kingdom", cc: "44" },
  { iso: "AE", name: "United Arab Emirates", cc: "971" },
  { iso: "SA", name: "Saudi Arabia", cc: "966" },
  { iso: "QA", name: "Qatar", cc: "974" },
  { iso: "SG", name: "Singapore", cc: "65" },
  { iso: "MY", name: "Malaysia", cc: "60" },
  { iso: "AU", name: "Australia", cc: "61" },
  { iso: "NZ", name: "New Zealand", cc: "64" },
  { iso: "DE", name: "Germany", cc: "49" },
  { iso: "FR", name: "France", cc: "33" },
  { iso: "NL", name: "Netherlands", cc: "31" },
  { iso: "IE", name: "Ireland", cc: "353" },
  { iso: "NP", name: "Nepal", cc: "977" },
  { iso: "BD", name: "Bangladesh", cc: "880" },
  { iso: "LK", name: "Sri Lanka", cc: "94" },
  { iso: "ID", name: "Indonesia", cc: "62" },
  { iso: "PH", name: "Philippines", cc: "63" },
  { iso: "NG", name: "Nigeria", cc: "234" },
  { iso: "KE", name: "Kenya", cc: "254" },
  { iso: "ZA", name: "South Africa", cc: "27" },
  { iso: "BR", name: "Brazil", cc: "55" },
];

const RESEND_S = 60;
type Stage = "number" | "code" | "details" | "email";

/**
 * Continue with WhatsApp (1060): its own screen, so it never gets mixed up with the password form.
 * One flow for signing in and signing up, run by /api/auth/whatsapp:
 *   number -> code on WhatsApp -> signed in (or the authenticator step)
 *                              -> no account yet: name, email, 18+ -> code by email -> account made, or the
 *                                 number linked to the account that already has that email -> signed in
 * Nothing on screen before the WhatsApp code is checked depends on whether the number has an account.
 */
export function WhatsAppAuth({
  mode,
  remember,
  rememberSlot,
  timezone,
  onSignedIn,
  onBack,
  onFail,
  cls,
}: {
  mode: "login" | "signup";
  remember: boolean;
  rememberSlot?: React.ReactNode;
  timezone: () => string | undefined;
  onSignedIn: (r: { twoFactor?: boolean }) => void;
  onBack: () => void;
  onFail: () => void;
  cls: { field: string; label: string; textBtn: string };
}) {
  const [stage, setStage] = useState<Stage>("number");
  const [phone, setPhone] = useState("+91");
  const [digits, setDigits] = useState(0); // how many digits were typed, for a friendly "enter your number"
  const [raw, setRaw] = useState({ iso: "IN", num: "" });
  const [masked, setMasked] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const numRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const ageRef = useRef<HTMLInputElement>(null);
  const boxes = useRef<OtpBoxesHandle>(null);
  // A pasted code plus an auto-submit could send the same code twice; the second "already used" would hide the first.
  const inFlight = useRef(false);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  useEffect(() => {
    requestAnimationFrame(() => (stage === "number" ? numRef.current?.focus() : stage === "details" ? nameRef.current?.focus() : boxes.current?.focus()));
  }, [stage]);


  const fail = (e: unknown) => {
    const msg = e instanceof ApiError ? e.message : "Something got in the way. Let's try again.";
    const secs = e instanceof ApiError && /(\d+) seconds/.exec(e.message);
    if (secs) setWait(Number(secs[1]));
    if (e instanceof ApiError && e.code === "WA_PROOF_GONE") {
      setStage("number");
      setCode("");
    }
    if (e instanceof ApiError && /^OTP_/.test(e.code ?? "")) setCode("");
    setError(msg);
    setNote(null);
    setBusy(false);
    inFlight.current = false;
    onFail();
    requestAnimationFrame(() => boxes.current?.focus());
  };
  const call = <T,>(json: Record<string, unknown>) => api<T>("/api/auth/whatsapp", { method: "POST", json });

  const sendWa = async () => {
    if (digits < 6) {
      setError("Enter your WhatsApp number.");
      onFail();
      return numRef.current?.focus();
    }
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ phone: string | null }>({ step: "send", phone });
      setMasked(r.phone);
      setCode("");
      setWait(RESEND_S);
      setStage("code");
      setNote(null);
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  };
  const verifyWa = async (c: string) => {
    if (inFlight.current) return;
    if (c.length !== 6) {
      setError("Enter all 6 digits of the code.");
      return onFail();
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNote("Checking your code…");
    try {
      const r = await call<{ twoFactor?: boolean; needsAccount?: boolean }>({ step: "verify", phone, code: c, remember });
      inFlight.current = false;
      setBusy(false);
      setNote(null);
      if (r.needsAccount) {
        setCode("");
        setWait(0);
        return setStage("details");
      }
      setNote("Verified. Opening Outlly…");
      onSignedIn(r);
    } catch (e) {
      fail(e);
    }
  };
  const sendEmail = async () => {
    if (!name.trim()) {
      setError("What should we call you?");
      onFail();
      return nameRef.current?.focus();
    }
    if (!adult) {
      setError("Please confirm you're 18 or older to create an account.");
      onFail();
      return ageRef.current?.focus();
    }
    setBusy(true);
    setError(null);
    try {
      await call({ step: "details", name, email, adult: true });
      setCode("");
      setWait(RESEND_S);
      setStage("email");
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  };
  const confirmEmail = async (c: string) => {
    if (inFlight.current) return;
    if (c.length !== 6) {
      setError("Enter all 6 digits of the code.");
      return onFail();
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNote("Checking your code…");
    try {
      const r = await call<{ twoFactor?: boolean; created?: boolean; linked?: boolean }>({ step: "confirm", name, email, adult: true, code: c, remember, timezone: timezone() });
      setNote(r.created ? "Account created. Opening Outlly…" : "WhatsApp added to your account. Opening Outlly…");
      onSignedIn(r);
    } catch (e) {
      fail(e);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (stage === "number") return void sendWa();
    if (stage === "code") return void verifyWa(code);
    if (stage === "details") return void sendEmail();
    return void confirmEmail(code);
  };
  const back = () => {
    setError(null);
    setNote(null);
    setCode("");
    inFlight.current = false;
    if (stage === "code") setStage("number");
    else if (stage === "email") setStage("details");
    else if (stage === "details") {
      // Retire the proven number on the server too, so this browser can't finish the sign-up later.
      void api("/api/auth/whatsapp", { method: "POST", json: { step: "abandon" } }).catch(() => {});
      setStage("number");
    }
    else onBack();
  };

  const heading = stage === "number" ? (mode === "signup" ? "Sign up with WhatsApp" : "Continue with WhatsApp") : stage === "code" ? "Check WhatsApp" : stage === "details" ? "Create your account" : "Confirm your email";
  const sub =
    stage === "number"
      ? "We'll send a 6-digit code to your WhatsApp. No password needed."
      : stage === "code"
        ? <>Enter the 6-digit code we sent to <span className="tabular whitespace-nowrap">{masked ?? "your number"}</span> on WhatsApp. It works for 10 minutes.</>
        : stage === "details"
          ? "Number verified. No account uses it yet, so add your details to finish."
          : <>Enter the 6-digit code we sent to <span className="break-all">{email.trim()}</span>. It works for 10 minutes.</>;
  const cta = busy
    ? stage === "number" || stage === "details" ? "Sending your code…" : "Checking…"
    : stage === "number" ? "Send code on WhatsApp" : stage === "code" ? "Verify and continue" : stage === "details" ? "Email me a code" : "Create my account";
  const codeStage = stage === "code" || stage === "email";
  const describedBy = [note ? "wa-note" : "", error ? "wa-error" : ""].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#25D366]/10 px-3 py-1 text-xs font-semibold text-foreground">
        <WhatsAppGlyph className="h-3.5 w-3.5" />
        WhatsApp code{stage === "details" || stage === "email" ? " · new account" : ""}
      </div>
      <h1 className="font-display text-[clamp(2rem,3.4vw,2.5rem)] font-bold leading-[1.05] tracking-[-0.035em]">{heading}</h1>
      <p className="mb-6 mt-2.5 max-w-[40ch] text-[15px] leading-relaxed text-muted-foreground">{sub}</p>
      <form onSubmit={submit} className="w-full space-y-4" noValidate>
        {stage === "number" && (
          <PhoneInput ref={numRef} id="wa-number" label="Your WhatsApp number" hint="The number you use WhatsApp on. Pick its country, or type it with its own + code." initial={raw} onPhone={(full, n, typed) => { setPhone(full); setDigits(n); setRaw(typed); }} describedBy={describedBy} invalid={!!error} cls={cls} />
        )}
        {stage === "details" && (
          <>
            <div>
              <Label htmlFor="wa-name" className={cls.label}>Your name</Label>
              <Input ref={nameRef} id="wa-name" autoComplete="name" required placeholder="Alex Rivera" value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} className={cls.field} />
            </div>
            <div>
              <Label htmlFor="wa-email" className={cls.label}>Your email</Label>
              <Input id="wa-email" type="email" inputMode="email" autoComplete="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value.slice(0, 200))} aria-describedby="wa-email-hint" className={cls.field} />
              <p id="wa-email-hint" className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                For receipts and getting back in. We&apos;ll email a code to confirm it. If you already use it on Outlly, your number is added to that account instead of making a second one.
              </p>
            </div>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl px-1 py-1.5 text-[13.5px] leading-snug has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
              <input ref={ageRef} type="checkbox" checked={adult} onChange={(e) => { setAdult(e.target.checked); if (e.target.checked && error?.includes("18")) setError(null); }} className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-lime-ink" />
              <span>I&apos;m 18 or older.</span>
            </label>
          </>
        )}
        {codeStage && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <Label htmlFor="wa-otp" className={`${cls.label} mb-0`}>{stage === "code" ? "WhatsApp code" : "Email code"}</Label>
              <button type="button" onClick={stage === "code" ? sendWa : sendEmail} disabled={busy || wait > 0} className={`${cls.textBtn} -my-2 -mr-3 text-xs tabular`} aria-live="polite">
                {wait > 0 ? `Resend code in ${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, "0")}` : "Resend code"}
              </button>
            </div>
            <OtpBoxes
              ref={boxes}
              id="wa-otp"
              label={stage === "code" ? "6-digit WhatsApp code" : "6-digit email code"}
              value={code}
              onChange={(v) => {
                setCode(v);
                if (error) setError(null);
              }}
              onComplete={(v) => void (stage === "code" ? verifyWa(v) : confirmEmail(v))}
              disabled={busy}
              invalid={!!error}
              describedBy={describedBy}
            />
          </div>
        )}
        {stage === "number" && rememberSlot}
        <p id="wa-note" role="status" className={note ? "text-sm leading-relaxed text-muted-foreground" : "sr-only"}>
          {note}
        </p>
        {error && (
          <p id="wa-error" role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" variant="lime" className="auth-cta h-12 w-full text-[15px]" disabled={busy} aria-busy={busy}>
          {cta}
          {!busy && <ArrowRight className="auth-cta-arrow h-[18px] w-[18px]" aria-hidden="true" />}
        </Button>
        <div className="-my-1 flex flex-wrap justify-center gap-x-1">
          <button type="button" className={cls.textBtn} onClick={back}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {stage === "number" ? (mode === "login" ? "Sign in another way" : "Sign up another way") : stage === "code" ? "Change number" : stage === "email" ? "Change email" : "Start again"}
          </button>
        </div>
        {stage === "details" && (
          <p className="text-center text-xs leading-relaxed text-muted-foreground">
            By creating an account, you agree to the{" "}
            <Link href="/terms" className="font-medium text-foreground underline underline-offset-4">Terms</Link> and{" "}
            <Link href="/privacy" className="font-medium text-foreground underline underline-offset-4">Privacy Policy</Link>.
          </p>
        )}
      </form>
    </div>
  );
}

/**
 * A WhatsApp number: country code picker (India preselected) plus the number. A number typed with its own
 * "+" wins over the picker; otherwise spaces and a leading trunk 0 are dropped. Reports the full +number.
 */
export const PhoneInput = forwardRef<HTMLInputElement, {
  id: string;
  label: string;
  hint: string;
  onPhone: (full: string, digits: number, raw: { iso: string; num: string }) => void;
  /** What was typed last time, so going back to change the number keeps it on screen. */
  initial?: { iso: string; num: string };
  describedBy?: string;
  invalid?: boolean;
  cls: { field: string; label: string };
}>(function PhoneInput({ id, label, hint, onPhone, initial, describedBy, invalid, cls }, ref) {
  const [iso, setIso] = useState(initial?.iso ?? "IN");
  const [num, setNum] = useState(initial?.num ?? "");
  const report = (i: string, n: string) => {
    const cc = COUNTRIES.find((c) => c.iso === i)?.cc ?? "91";
    const own = n.trim().startsWith("+");
    onPhone(own ? n.trim() : `+${cc}${n.replace(/\D/g, "").replace(/^0+/, "")}`, n.replace(/\D/g, "").length, { iso: i, num: n });
  };
  return (
    <div>
      <Label htmlFor={id} className={cls.label}>{label}</Label>
      <div className="flex gap-2">
        <div className="relative shrink-0">
          <label htmlFor={`${id}-cc`} className="sr-only">Country code</label>
          <select
            id={`${id}-cc`}
            value={iso}
            onChange={(e) => {
              setIso(e.target.value);
              report(e.target.value, num);
            }}
            className={`${cls.field} tabular h-12 w-[6.75rem] cursor-pointer appearance-none pl-3.5 pr-8 text-[15px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring`}
          >
            {COUNTRIES.map((c) => (
              <option key={c.iso} value={c.iso}>
                {c.iso} +{c.cc}
              </option>
            ))}
          </select>
          <svg viewBox="0 0 16 16" className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true">
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <Input
          ref={ref}
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          required
          placeholder={iso === "IN" ? "98765 43210" : "Phone number"}
          value={num}
          onChange={(e) => {
            const n = e.target.value.slice(0, 24);
            setNum(n);
            report(iso, n);
          }}
          aria-describedby={[`${id}-hint`, describedBy].filter(Boolean).join(" ")}
          aria-invalid={invalid || undefined}
          className={`${cls.field} tabular min-w-0 flex-1 text-[15px]`}
        />
      </div>
      <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
});

/** WhatsApp's mark in its own green, as Meta's brand guide asks. Decorative: the text next to it names it. */
export function WhatsAppGlyph({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0`} aria-hidden="true" focusable="false">
      <path fill="#25D366" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Z" />
      <path fill="#fff" d="M16.9 14.4c-.3-.1-1.6-.8-1.8-.9-.3-.1-.4-.1-.6.1l-.8 1c-.2.2-.3.2-.6.1a6.8 6.8 0 0 1-3.4-3c-.3-.4.3-.4.8-1.3.1-.2 0-.3 0-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.6-.3Z" />
    </svg>
  );
}
