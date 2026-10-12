"use client";
import { useRef, useState } from "react";
import { Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";
import { Pip, type PipMood } from "@/components/brand/Pip";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { adminApi } from "@/lib/client/admin-api";

export function AdminLoginForm({ next }: { next: string }) {
  const [login, setLogin] = useState("admin");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mood, setMood] = useState<PipMood>("wave");
  const pw = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) {
      setError("Enter your password.");
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
      requestAnimationFrame(() => pw.current?.focus());
    }
  }

  return (
    <form onSubmit={submit} noValidate className="glass-strong rounded-[32px] p-7 sm:p-8" aria-describedby={error ? "admin-login-error" : undefined}>
      <div className="mb-5 flex items-center gap-4">
        <Pip size={64} mood={mood} />
        <div>
          <p className="eyebrow text-[11px]">Team console</p>
          <h1 className="font-display text-[1.55rem] font-bold leading-tight tracking-[-0.03em]">Admin sign in</h1>
        </div>
      </div>

      <Label htmlFor="admin-login">Login</Label>
      <Input id="admin-login" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} className="mb-4" required />

      <Label htmlFor="admin-password">Password</Label>
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
          className="pr-12 tracking-[0.2em]"
          aria-invalid={!!error}
          required
        />
        <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label={show ? "Hide password" : "Show password"}>
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      <div className="liquid-panel" data-open={!!error}>
        <div>
          <p id="admin-login-error" role="alert" className="liquid-inner mt-3 rounded-2xl bg-destructive/10 px-4 py-3 text-[13.5px] text-destructive">
            {error}
          </p>
        </div>
      </div>

      <Button type="submit" variant="lime" size="lg" className="mt-6 w-full" disabled={busy}>
        {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
        {busy ? "Checking" : "Sign in"}
      </Button>
      <p className="mt-4 flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Separate from creator accounts. 6 tries per 15 minutes.
      </p>
    </form>
  );
}
