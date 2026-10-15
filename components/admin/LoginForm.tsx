"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { Pip, type PipMood } from "@/components/brand/Pip";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { adminApi } from "@/lib/client/admin-api";
import { MOTION_OK, gsap, useGSAP } from "@/lib/motion/gsap";

/**
 * Admin sign in, styled like the creator AuthForm (10-15e): same fields, lime CTA, staggered entrance and
 * a small shake when sign-in fails. Pip reacts (wave, think, happy, sad). Logic unchanged: POST
 * /api/admin/login, remaining-attempts warning, then a full navigation to `next`.
 */
export function AdminLoginForm({ next }: { next: string }) {
  const [login, setLogin] = useState("admin");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mood, setMood] = useState<PipMood>("wave");
  const [tries, setTries] = useState(0);
  const pw = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLDivElement>(null);

  const { contextSafe } = useGSAP(() => {
    const root = ref.current;
    if (!root) return;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.fromTo(gsap.utils.selector(root)(".gs-in"), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out", stagger: 0.045, delay: 0.05 });
    });
  }, { scope: ref });
  const shake = contextSafe(() => {
    if (!ref.current || !window.matchMedia(MOTION_OK).matches) return;
    gsap.fromTo(ref.current, { x: 0 }, { keyframes: { x: [-9, 8, -6, 4, -2, 0] }, duration: 0.45, ease: "power1.out", clearProps: "x" });
  });
  useEffect(() => {
    if (tries) shake();
  }, [tries, shake]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) {
      setError("Enter your password.");
      setTries((t) => t + 1);
      pw.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setMood("think");
    try {
      await adminApi("/api/admin/login", { method: "POST", json: { login, password } });
      setMood("happy");
      window.location.assign(next);
    } catch (err: any) {
      const left = err?.data?.remaining;
      setError(err.message + (typeof left === "number" && left <= 3 ? ` ${left} attempt${left === 1 ? "" : "s"} left before a 15 minute pause.` : ""));
      setMood("sad");
      setPassword("");
      setBusy(false);
      setTries((t) => t + 1);
      requestAnimationFrame(() => pw.current?.focus());
    }
  }

  const label = "mb-1.5 text-[14px] font-semibold text-foreground";
  const field = "h-12 rounded-xl border border-border bg-card shadow-[0_1px_2px_hsl(var(--foreground)/0.05)] hover:border-foreground/25 focus:border-foreground/40 focus:bg-card";

  return (
    <div ref={ref} className="gs-stage">
      <div className="gs-in mb-4 flex [@media(max-height:800px)]:hidden">
        <Pip size={56} mood={mood} />
      </div>
      <h1 className="gs-in font-display text-[clamp(2rem,3.4vw,2.5rem)] font-bold leading-[1.05] tracking-[-0.035em]">Admin sign in</h1>
      <p className="gs-in mb-6 mt-2.5 max-w-[40ch] text-[15px] leading-relaxed text-muted-foreground">The Outlly team console. Separate from creator accounts.</p>

      <form onSubmit={submit} noValidate className="w-full space-y-4 [@media(max-height:800px)]:space-y-3" aria-describedby={error ? "admin-login-error" : undefined}>
        <div className="gs-in">
          <Label htmlFor="admin-login" className={label}>Login</Label>
          <Input id="admin-login" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} className={field} required />
        </div>

        <div className="gs-in">
          <Label htmlFor="admin-password" className={label}>Password</Label>
          <div className="relative">
            <Input
              ref={pw}
              id="admin-password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (mood === "sad") setMood("idle");
              }}
              className={`${field} pr-12`}
              aria-invalid={!!error}
              required
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" /> : <Eye className="h-[18px] w-[18px]" aria-hidden="true" />}
            </button>
          </div>
        </div>

        {error && (
          <p id="admin-login-error" role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="gs-in">
          <Button type="submit" variant="lime" className="auth-cta h-12 w-full text-[15px]" disabled={busy} aria-busy={busy}>
            {busy ? "Checking" : "Sign in"}
            {!busy && <ArrowRight className="auth-cta-arrow h-[18px] w-[18px]" aria-hidden="true" />}
          </Button>
        </div>

        <p className="gs-in flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> 6 tries per 15 minutes.
        </p>
        <p className="gs-in text-center text-sm text-muted-foreground">
          Looking for your creator account?{" "}
          <Link href="/login" className="rounded font-semibold text-lime-ink underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            Sign in here
          </Link>
        </p>
      </form>
    </div>
  );
}
