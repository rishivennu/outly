"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Check, Compass, LogOut } from "lucide-react";
import { startTour } from "@/components/onboarding/Tour";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { Icon3D } from "@/components/brand/Icon3D";
import { useUser, tzShort } from "@/components/shell/UserContext";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";

export type SimMode = "realistic" | "smooth" | "instagram-reconnect" | "youtube-flaky" | "x-rejects";

const MODES: { id: SimMode; title: string; body: string }[] = [
  { id: "realistic", title: "Like real life", body: "Mostly smooth. Now and then a platform asks us to slow down, and we retry on our own." },
  { id: "smooth", title: "Everything works", body: "Every platform says yes the first time. Good for a quick demo." },
  { id: "instagram-reconnect", title: "Instagram needs you", body: "Instagram's sign-in has expired, so you'll see the reconnect flow." },
  { id: "youtube-flaky", title: "YouTube is wobbly", body: "YouTube fails a couple of times, then gets there with retries." },
  { id: "x-rejects", title: "X says no", body: "X turns the video down, so you'll see a failure that needs a fix." },
];

function zones(): string[] {
  const anyIntl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  try {
    if (anyIntl.supportedValuesOf) return anyIntl.supportedValuesOf("timeZone");
  } catch {}
  return ["UTC", "Asia/Kolkata", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney"];
}

export function SettingsView({ sim, mock }: { sim: SimMode; mock: boolean }) {
  const user = useUser();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [timezone, setTimezone] = useState(user.timezone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<SimMode>(sim);
  const [leaving, setLeaving] = useState(false);
  // Server and browser Intl data differ, so zone lists and short names render after mount (no hydration mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const allZones = useMemo(() => {
    if (!mounted) return [timezone];
    const z = zones();
    return z.includes(timezone) ? z : [timezone, ...z];
  }, [timezone, mounted]);
  const dirty = name.trim() !== user.name || timezone !== user.timezone;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api("/api/settings/profile", { method: "PATCH", json: { name: name.trim(), timezone } });
      toast("Saved. Everything now runs on your time.");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something got in the way.");
    } finally {
      setSaving(false);
    }
  };

  const pick = async (m: SimMode) => {
    const prev = mode;
    setMode(m);
    try {
      await api("/api/settings/simulation", { method: "POST", json: { mode: m } });
      toast(`Practice mode: ${MODES.find((x) => x.id === m)!.title.toLowerCase()}.`, "info");
    } catch {
      setMode(prev);
      toast("Couldn't switch that. Let's try again.", "info");
    }
  };

  const logout = async () => {
    setLeaving(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  };

  return (
    <div className="px-5 pb-16 pt-8 sm:px-10 lg:pt-14">
      <p className="eyebrow mb-3">Settings</p>
      <h1 className="display max-w-3xl text-[clamp(2.6rem,6vw,4.6rem)]">Make it yours.</h1>

      <div className="mt-10 grid max-w-5xl gap-4 lg:grid-cols-[1.1fr_1fr]">
        <motion.form onSubmit={save} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-[32px] p-6 sm:p-8" aria-labelledby="you">
          <h2 id="you" className="text-2xl font-semibold tracking-tight">You</h2>
          <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
          <div className="mt-6 space-y-5">
            <div>
              <Label htmlFor="name">What should we call you?</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" required />
            </div>
            <div>
              <Label htmlFor="tz">
                Your time zone <span className="tabular">{mounted ? tzShort(timezone) : ""}</span>
              </Label>
              <select id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} className="h-12 w-full rounded-2xl bg-secondary/60 px-4 text-base text-foreground hairline focus-visible:outline-2">
                {allZones.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-muted-foreground">Scheduling and the calendar use this.</p>
            </div>
          </div>
          {error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" className="mt-6" disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </motion.form>

        <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }} className="glass rounded-[32px] p-6 sm:p-8" aria-labelledby="practice">
          <h2 id="practice" className="text-2xl font-semibold tracking-tight">Practice mode</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {mock ? "Nothing really gets posted. Pick how the pretend platforms behave, so you can see every state." : "Real platforms are connected, so these only affect platforms still in practice mode."}
          </p>
          <div role="radiogroup" aria-labelledby="practice" className="mt-5 space-y-2">
            {MODES.map((m) => {
              const on = mode === m.id;
              return (
                <button key={m.id} type="button" role="radio" aria-checked={on} onClick={() => !on && pick(m.id)} className={cn("flex min-h-[44px] w-full items-start gap-3 rounded-2xl p-3 text-left transition-colors", on ? "bg-secondary hairline" : "hover:bg-secondary/50")}>
                  <span className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border", on ? "lime-bg border-transparent" : "border-muted-foreground/40")} aria-hidden="true">
                    {on && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span>
                    <span className="block text-[15px] font-medium">{m.title}</span>
                    <span className="block text-sm text-muted-foreground">{m.body}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </motion.section>

        <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="glass flex flex-wrap items-center justify-between gap-6 rounded-[32px] p-6 sm:p-8 lg:col-span-2" aria-labelledby="look">
          <div className="flex items-center gap-4">
            <Icon3D name="settings" size={64} className="shrink-0" />
            <div>
              <h2 id="look" className="text-2xl font-semibold tracking-tight">Look</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">Outly comes in light and dark. System follows your device.</p>
            </div>
          </div>
          <ThemeToggle plain className="shrink-0" />
        </motion.section>

        <section className="glass flex flex-wrap items-center justify-between gap-4 rounded-[32px] p-6 lg:col-span-2" aria-labelledby="tour-h">
          <div>
            <h2 id="tour-h" className="text-lg font-semibold">Guided tour</h2>
            <p className="text-sm text-muted-foreground">A one-minute walk through posting, analytics, the inbox and connecting accounts.</p>
          </div>
          <Button variant="outline" onClick={() => startTour()}>
            <Compass className="h-4 w-4" aria-hidden="true" /> Replay the tour
          </Button>
        </section>

        <section className="glass flex flex-wrap items-center justify-between gap-4 rounded-[32px] p-6 lg:col-span-2" aria-label="Session">
          <div>
            <h2 className="text-lg font-semibold">Heading out?</h2>
            <p className="text-sm text-muted-foreground">Your drafts and schedule stay put.</p>
          </div>
          <Button variant="ghost" onClick={logout} disabled={leaving}>
            <LogOut className="h-4 w-4" /> {leaving ? "Signing out…" : "Sign out"}
          </Button>
        </section>
      </div>
    </div>
  );
}
