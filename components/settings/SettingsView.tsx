"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Compass, LogOut, Mail } from "lucide-react";
import { startTour } from "@/components/onboarding/Tour";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { Icon3D } from "@/components/brand/Icon3D";
import { useUser, tzShort } from "@/components/shell/UserContext";
import { api, ApiError } from "@/lib/client/api";
import { TeamCard } from "./TeamCard";
import { ReferralCard } from "./ReferralCard";

function zones(): string[] {
  const anyIntl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  try {
    if (anyIntl.supportedValuesOf) return anyIntl.supportedValuesOf("timeZone");
  } catch {}
  return ["UTC", "Asia/Kolkata", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney"];
}

/** Monday summary email on/off. Saves the moment it's flipped. */
function WeeklyReportCard({ initial }: { initial: boolean }) {
  const toast = useToast();
  const [on, setOn] = useState(initial);
  const [saving, setSaving] = useState(false);
  const flip = async (next: boolean) => {
    setOn(next);
    setSaving(true);
    try {
      await api("/api/settings/profile", { method: "PATCH", json: { weeklyReport: next } });
      toast(next ? "You'll get your weekly report on Monday morning." : "Weekly report turned off.", "ok");
    } catch (err) {
      setOn(!next);
      toast(err instanceof ApiError ? err.message : "Something got in the way.", "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="glass flex items-center justify-between gap-4 rounded-[32px] p-6" aria-labelledby="wr-h">
      <div className="flex items-start gap-3">
        <Mail className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <h2 id="wr-h" className="text-lg font-semibold">Weekly report</h2>
          <p id="wr-d" className="text-sm text-muted-foreground">Every Monday at 9 am your time: views, top post and what's scheduled next.</p>
        </div>
      </div>
      <label className="flex shrink-0 cursor-pointer items-center">
        <span className="sr-only">Email me a weekly report</span>
        <input type="checkbox" role="switch" checked={on} disabled={saving} aria-describedby="wr-d" onChange={(e) => flip(e.target.checked)} className="peer sr-only" />
        <span aria-hidden className="relative h-7 w-12 shrink-0 rounded-full bg-muted transition-colors peer-checked:bg-lime peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-background after:shadow after:transition-transform after:duration-300 peer-checked:after:translate-x-5" />
      </label>
    </section>
  );
}

export function SettingsView({ weeklyReport = true }: { weeklyReport?: boolean }) {
  const user = useUser();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [timezone, setTimezone] = useState(user.timezone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        {user.workspace ? (
          <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-[32px] p-6 sm:p-8" aria-labelledby="you">
            <h2 id="you" className="text-2xl font-semibold tracking-tight">You</h2>
            <p className="mt-1 text-sm text-muted-foreground">{user.workspace.me.name} · {user.workspace.me.email}</p>
            <p className="mt-5 text-sm">
              You're in <b>{user.workspace.ownerName}</b>'s studio. Your own name, time zone and emails are changed from your own studio.
            </p>
          </motion.section>
        ) : (
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
        )}

        <div className="grid content-start gap-4">
          <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }} className="glass rounded-[32px] p-6 sm:p-8" aria-labelledby="look">
            <div className="flex items-center gap-4">
              <Icon3D name="settings" size={64} className="shrink-0" />
              <div>
                <h2 id="look" className="text-2xl font-semibold tracking-tight">Look</h2>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">Outlly comes in light and dark. System follows your device.</p>
              </div>
            </div>
            <ThemeToggle plain className="mt-5" />
          </motion.section>

          <section className="glass flex flex-wrap items-center justify-between gap-4 rounded-[32px] p-6" aria-labelledby="tour-h">
            <div>
              <h2 id="tour-h" className="text-lg font-semibold">Guided tour</h2>
              <p className="text-sm text-muted-foreground">A one-minute walk through posting, analytics, the inbox and connecting accounts.</p>
            </div>
            <Button variant="outline" onClick={() => startTour()}>
              <Compass className="h-4 w-4" aria-hidden="true" /> Replay the tour
            </Button>
          </section>
        </div>

        {!user.workspace && <WeeklyReportCard initial={weeklyReport} />}
        <div className={user.workspace ? "lg:col-span-2" : undefined}>
          <ReferralCard />
        </div>
        <div className="lg:col-span-2">
          <TeamCard />
        </div>

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
