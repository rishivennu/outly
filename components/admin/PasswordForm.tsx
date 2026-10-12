"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import { cn } from "@/lib/utils";

function strength(p: string) {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p) && /[^\w]/.test(p)) s++;
  return s;
}

export function PasswordForm({ weak }: { weak: boolean }) {
  const [cur, setCur] = useState(weak ? "" : "");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();
  const s = strength(next);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== again) return setErr("The two new passwords don't match.");
    setBusy(true);
    setErr(null);
    try {
      await adminApi("/api/admin/password", { method: "POST", json: { current: cur, next } });
      toast("Password changed");
      setCur(""); setNext(""); setAgain("");
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <div><Label htmlFor="pw-c">Current password</Label><Input id="pw-c" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></div>
      <div>
        <Label htmlFor="pw-n">New password <span className="text-[11.5px]">8+ characters</span></Label>
        <Input id="pw-n" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} required aria-describedby="pw-meter" />
        <div id="pw-meter" className="mt-2 flex items-center gap-2" aria-live="polite">
          {[0, 1, 2, 3].map((i) => <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors duration-300", i < s ? (s < 2 ? "bg-destructive" : s < 3 ? "bg-warning" : "bg-success") : "bg-secondary")} />)}
          <span className="w-14 text-right text-[12px] text-muted-foreground">{next ? ["Weak", "Weak", "Okay", "Good", "Strong"][s] : ""}</span>
        </div>
      </div>
      <div><Label htmlFor="pw-a">New password again</Label><Input id="pw-a" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required /></div>
      {err && <p role="alert" className="rounded-2xl bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">{err}</p>}
      <Button type="submit" variant="lime" disabled={busy || next.length < 8}>{busy ? "Saving…" : "Change password"}</Button>
    </form>
  );
}
