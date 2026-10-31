"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CalendarClock, Compass, CreditCard, Eye, Gift, Lock, Mail, Palette, ShieldCheck, Sparkles, Trophy, UserRound, Users } from "lucide-react";
import { startTour } from "@/components/onboarding/Tour";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { CursorToggle } from "@/components/shell/AvatarCursor";
import { Icon3D } from "@/components/brand/Icon3D";
import { useUser, tzShort } from "@/components/shell/UserContext";
import { api, ApiError } from "@/lib/client/api";
import { TeamCard } from "./TeamCard";
import { ReferralCard } from "./ReferralCard";
import { AvatarPicker } from "./AvatarPicker";
import { SnippetsCard } from "./SnippetsCard";
import { TwoStepCard } from "./TwoStepCard";
import { PhoneCard } from "./PhoneCard";
import { YourDataCard } from "./YourDataCard";
import { AlertsCard } from "./AlertsCard";
import { ALERT_DEFAULTS, type AlertPrefs } from "@/lib/alerts-core";
import { SettingsShell, Disclosure, useUnsaved, type SettingsCategory } from "./SettingsShell";
import { RememberedDevicesCard, SessionsCard } from "./SecurityCards";
import { ActiveSessionsCard } from "./ActiveSessionsCard";
import { ConnectedAccountsCard, LocationCard } from "./PrivacyCards";
import { BillingDetailsSection, HistorySection, InvoicesSection, MemberBillingNote, MethodsSection, PaymentsBento, PlanSection, type BillingSummary } from "./BillingCards";

function zones(): string[] {
  const anyIntl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  try {
    if (anyIntl.supportedValuesOf) return anyIntl.supportedValuesOf("timeZone");
  } catch {}
  return ["UTC", "Asia/Kolkata", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney"];
}

const WR_PARTS = [
  { label: "Views for the week", Ico: Eye },
  { label: "Your top post", Ico: Trophy },
  { label: "What's up next", Ico: CalendarClock },
];

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
    <section className="glass flex h-full flex-col rounded-[32px] p-6 sm:p-8" aria-labelledby="wr-h">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-secondary/70 hairline" aria-hidden="true">
            <Mail className="h-5 w-5" />
          </span>
          <div>
            <h2 id="wr-h" className="text-2xl font-semibold tracking-tight">Weekly report</h2>
            <p id="wr-d" className="mt-1 text-sm text-muted-foreground">An email every Monday at 9 am your time.</p>
          </div>
        </div>
        <label className="flex min-h-[44px] shrink-0 cursor-pointer items-center">
          <span className="sr-only">Email me a weekly report</span>
          <input type="checkbox" role="switch" checked={on} disabled={saving} aria-describedby="wr-d" onChange={(e) => flip(e.target.checked)} className="peer sr-only" />
          <span aria-hidden className="relative h-7 w-12 shrink-0 rounded-full bg-muted transition-colors peer-checked:bg-lime peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-background after:shadow after:transition-transform after:duration-300 peer-checked:after:translate-x-5" />
        </label>
      </div>
      <ul className="mt-5 grid flex-1 grid-cols-3 gap-2" aria-label="What's in it">
        {WR_PARTS.map(({ label, Ico }) => (
          <li key={label} className={"flex min-h-[84px] flex-col justify-between gap-3 rounded-2xl p-3 hairline transition-opacity " + (on ? "bg-secondary/60" : "bg-secondary/30 opacity-60")}>
            <Ico className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-[13px] font-medium leading-tight">{label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] text-muted-foreground" aria-live="polite">{on ? "On. The next one lands Monday morning." : "Off. Flip the switch to get it again."}</p>
    </section>
  );
}

/** Name and time zone. Says when it has unsaved changes, so switching category or leaving never loses them silently. */
function ProfileForm() {
  const user = useUser();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [timezone, setTimezone] = useState(user.timezone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Server and browser Intl data differ, so zone lists and short names render after mount (no hydration mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const allZones = useMemo(() => {
    if (!mounted) return [timezone];
    const z = zones();
    return z.includes(timezone) ? z : [timezone, ...z];
  }, [timezone, mounted]);
  const dirty = name.trim() !== user.name || timezone !== user.timezone;
  useUnsaved("profile", dirty);

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
  const reset = () => {
    setName(user.name);
    setTimezone(user.timezone);
    setError(null);
  };

  return (
    <form onSubmit={save} className="glass rounded-[32px] p-6 sm:p-8" aria-labelledby="you">
      <h2 id="you" className="text-2xl font-semibold tracking-tight">You</h2>
      <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="name">What should we call you?</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" required />
        </div>
        <div>
          <Label htmlFor="tz">
            Your time zone <span className="tabular">{mounted ? tzShort(timezone) : ""}</span>
          </Label>
          <select id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} aria-describedby="tz-d" className="h-12 w-full rounded-2xl bg-secondary/60 px-4 text-base text-foreground hairline focus-visible:outline-2">
            {allZones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <p id="tz-d" className="mt-2 text-xs text-muted-foreground">Scheduling and the calendar use this.</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        {dirty && !saving && (
          <Button type="button" variant="ghost" onClick={reset}>
            Discard
          </Button>
        )}
      </div>
    </form>
  );
}

function Look() {
  return (
    <section className="glass rounded-[32px] p-6 sm:p-8" aria-labelledby="look">
      <div className="flex items-center gap-4">
        <Icon3D name="settings" size={56} className="shrink-0" />
        <div>
          <h2 id="look" className="text-2xl font-semibold tracking-tight">Look</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">Outlly comes in light and dark. System follows your device.</p>
        </div>
      </div>
      <ThemeToggle plain className="mt-5" />
      <CursorToggle />
    </section>
  );
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass rounded-[32px] p-6 sm:p-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </section>
  );
}

export function SettingsView({ weeklyReport = true, alerts = ALERT_DEFAULTS, billing = null, initialTab }: { weeklyReport?: boolean; alerts?: AlertPrefs; billing?: BillingSummary | null; initialTab?: string }) {
  const user = useUser();
  const ws = user.workspace;
  const owner = ws?.ownerName ?? "the owner";

  const categories: SettingsCategory[] = [
    {
      id: "profile",
      label: "Profile",
      icon: UserRound,
      blurb: "Your name, time zone and avatar.",
      content: ws ? (
        <Note title="You">
          {ws.me.name} · {ws.me.email}. You&apos;re in <b className="text-foreground">{ws.ownerName}</b>&apos;s studio. Your own name, time zone and emails are changed from your own studio.
        </Note>
      ) : (
        <>
          <ProfileForm />
          <AvatarPicker />
        </>
      ),
    },
    {
      id: "appearance",
      label: "Appearance",
      icon: Palette,
      blurb: "Light or dark, and how the cursor looks.",
      content: <Look />,
    },
    {
      id: "security",
      label: "Security",
      icon: ShieldCheck,
      blurb: "Two-step sign-in, remembered devices and where you're signed in.",
      content: (
        <>
          {!ws && <TwoStepCard email={user.email} />}
          <ActiveSessionsCard />
          <RememberedDevicesCard twoStepNote={!ws} />
          {!ws && <PhoneCard />}
          <SessionsCard />
        </>
      ),
    },
    {
      id: "personalization",
      label: "Personalization",
      icon: Sparkles,
      blurb: "Shortcuts that make writing faster, and the guided tour.",
      content: (
        <>
          <SnippetsCard />
          <Disclosure title="Guided tour" hint="Replay the one-minute walk, and bring back each page's first-time tips.">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">A one-minute walk from Home to Settings. Replaying it also brings back the tips each page shows the first time.</p>
              <Button variant="outline" onClick={() => startTour()}>
                <Compass className="h-4 w-4" aria-hidden="true" /> Replay the tour
              </Button>
            </div>
          </Disclosure>
        </>
      ),
    },
    {
      id: "notifications",
      label: "Notifications",
      icon: Bell,
      blurb: "The Monday report and the alerts we send you.",
      content: ws ? (
        <Note title="Emails come from your own studio">Weekly reports and alerts for {owner}&apos;s studio go to {owner}.</Note>
      ) : (
        <>
          <WeeklyReportCard initial={weeklyReport} />
          <AlertsCard initial={alerts} />
        </>
      ),
    },
    { id: "team", label: "Team", icon: Users, blurb: "Who can work in this studio.", content: <TeamCard /> },
    { id: "referral", label: "Referral", icon: Gift, blurb: "Share your link and see who joined through it.", content: <ReferralCard /> },
    {
      id: "billing",
      label: "Billing & Subscription",
      icon: CreditCard,
      blurb: "Your plan, how you pay, payment history and invoices.",
      content: billing ? (
        <>
          <PaymentsBento b={billing} />
          <PlanSection b={billing} />
          <MethodsSection b={billing} />
          <HistorySection b={billing} />
          <InvoicesSection b={billing} />
          <BillingDetailsSection b={billing} />
        </>
      ) : (
        <MemberBillingNote owner={owner} />
      ),
    },
    {
      id: "privacy",
      label: "Data & Privacy",
      icon: Lock,
      blurb: "Your data, the accounts Outlly can post to, and what we know about where you are.",
      content: (
        <>
          {!ws && <YourDataCard email={user.email} />}
          <ConnectedAccountsCard />
          <LocationCard />
        </>
      ),
    },
  ];

  return <SettingsShell title="Make it yours." intro="Everything about your account, one category at a time. Changes save where you make them." categories={categories} initialTab={initialTab} />;
}
