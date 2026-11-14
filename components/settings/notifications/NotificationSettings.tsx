"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Bell, BellOff, BellRing, CalendarClock, Check, CircleAlert, CreditCard, Laptop, Mail, MessageCircle, Moon, MonitorSmartphone,
  Plus, Send, Share, Smartphone, SquarePlus, Trash2, Rocket, UserRoundCheck, Inbox, Sparkles, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { CATEGORIES, CENTRE_TABS, EVENT_INFO, GREET_LABEL, GREET_SLOTS, LEADS, centreTabOf, type CategoryId, type CentreTab, type EventKey, type NotifyPatch, type NotifyPrefs } from "@/lib/notify-core";
import {
  currentSub, deniedHelp, disablePushHere, dismiss, dismissed, enablePush, permission, pushSupport, setBadge, stateOf, syncHere,
  type Device, type PushState, type PushSupport,
} from "@/lib/client/push";
import { Choice, Expand, Switch, SwitchRow, ago } from "./parts";

type Initial = { prefs: NotifyPrefs; tz: string; publicKey: string; devices: Device[] };
type Notice = { id: string; kind: string; tone: "danger" | "warn" | "info"; title: string; body: string; href: string | null; action: string | null; read: boolean; createdAt: string };

const CAT_ICON: Record<CategoryId, typeof Bell> = { publishing: Rocket, schedule: CalendarClock, account: UserRoundCheck, engagement: MessageCircle, billing: CreditCard };
const SECTIONS = [
  { id: "nf-device", label: "This device", icon: BellRing },
  { id: "nf-types", label: "What to notify", icon: Bell },
  { id: "nf-assist", label: "Assistant", icon: Sparkles },
  { id: "nf-delivery", label: "Delivery", icon: Mail },
  { id: "nf-devices", label: "Connected devices", icon: MonitorSmartphone },
  { id: "nf-preview", label: "Preview & test", icon: Send },
  { id: "nf-history", label: "History", icon: Inbox },
] as const;

const STATUS: Record<"enabled" | "disabled" | "required" | "unsupported", { label: string; cls: string }> = {
  enabled: { label: "Enabled", cls: "is-ok" },
  disabled: { label: "Disabled", cls: "is-off" },
  required: { label: "Permission required", cls: "is-warn" },
  unsupported: { label: "Not supported", cls: "is-off" },
};

function statusOf(s: PushState | null, perm: string, pushOn: boolean): keyof typeof STATUS | null {
  if (s === null) return null;
  if (s === "unsupported") return "unsupported";
  if (s === "ios-needs-install") return "required";
  if (s === "denied") return "required"; // blocked in the browser: only the person can undo it, so it asks for action
  if (s === "on") return pushOn ? "enabled" : "disabled";
  return perm === "granted" ? "disabled" : "required";
}

const leadText = (m: number) => (m === 60 ? "1 hour before" : `${m} minutes before`);

function zones(tz: string): string[] {
  const anyIntl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  let z: string[] = [];
  try {
    z = anyIntl.supportedValuesOf?.("timeZone") ?? [];
  } catch {}
  if (!z.length) z = ["UTC", "Asia/Kolkata", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney"];
  return z.includes(tz) ? z : [tz, ...z];
}

export function MemberNotificationsNote({ owner }: { owner: string }) {
  return (
    <div className="nf page-frame pb-16 pt-8 lg:pt-14">
      <Header status={null} />
      <div className="nf-card mt-8 max-w-2xl p-6 sm:p-8" style={{ "--i": 1 } as React.CSSProperties}>
        <h2 className="text-xl font-semibold tracking-tight">Notifications come from {owner}&apos;s own settings</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">You&apos;re working in {owner}&apos;s studio, so alerts about its posts, accounts and billing go to {owner}. Switch back to your own studio to manage yours.</p>
      </div>
    </div>
  );
}

function Header({ status }: { status: keyof typeof STATUS | null }) {
  const s = status ? STATUS[status] : null;
  return (
    <header>
      <Link href="/settings?tab=notifications" className="nf-back">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Settings
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <span className="nf-bell" aria-hidden="true">
          <Bell className="h-6 w-6" />
        </span>
        <h1 className="display text-[clamp(2.1rem,5vw,3.4rem)]">Notifications</h1>
        {s && (
          <span role="status" className={cn("nf-status", s.cls)}>
            <span className="nf-dot" aria-hidden="true" />
            <span className="sr-only">Push notifications: </span>
            {s.label}
          </span>
        )}
      </div>
      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">Choose what Outlly tells you about, and where: this device, the bell, or email.</p>
    </header>
  );
}

export function NotificationSettings({ initial, spikeAllowed }: { initial: Initial; spikeAllowed: boolean }) {
  const toast = useToast();
  const [prefs, setPrefs] = useState(initial.prefs);
  const [tz, setTz] = useState(initial.tz);
  const [devices, setDevices] = useState(initial.devices);
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [perm, setPerm] = useState<string>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Browser facts are only known after mount (no hydration mismatch); the header shows no status until then.
  const refresh = useCallback(async () => {
    const s = pushSupport();
    setSupport(s);
    setPerm(permission());
    setLater(dismissed());
    if (s !== "supported") return setSubscribed(false);
    const sub = await currentSub().catch(() => null);
    if (!sub) return setSubscribed(false);
    const d = await syncHere(initial.publicKey);
    if (d) setDevices(d);
    setSubscribed(!!d?.some((x) => x.current));
  }, [initial.publicKey]);
  useEffect(() => {
    void refresh();
    const onVis = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  const state = support === null ? null : stateOf(support, perm as NotificationPermission, subscribed);
  const status = statusOf(state, perm, prefs.ch.push);

  const save = async (patch: NotifyPatch, done?: string) => {
    const before = prefs;
    setPrefs((p) => optimistic(p, patch));
    setSaving(true);
    try {
      const r = await api<{ prefs: NotifyPrefs }>("/api/settings/notifications", { method: "PATCH", json: patch });
      setPrefs(r.prefs);
      if (done) toast(done, "ok");
    } catch (err) {
      setPrefs(before);
      toast(err instanceof ApiError ? err.message : "Something got in the way. Nothing changed.", "error");
    } finally {
      setSaving(false);
    }
  };

  const enable = async () => {
    setBusy("enable");
    try {
      const d = await enablePush(initial.publicKey);
      setDevices(d);
      setSubscribed(d.some((x) => x.current));
      setPerm(permission());
      if (!prefs.ch.push) await save({ ch: { push: true } });
      toast("Notifications are on for this device.", "ok");
    } catch (e) {
      setPerm(permission());
      const code = (e as { code?: string }).code;
      if (code !== "denied" && code !== "default") toast(e instanceof Error ? e.message : "Couldn't turn notifications on.", "error");
    } finally {
      setBusy(null);
    }
  };

  const disableHere = async () => {
    setBusy("disable");
    const d = await disablePushHere().catch(() => null);
    if (d) setDevices(d);
    setSubscribed(false);
    setBusy(null);
    toast("This device won't get notifications any more.", "ok");
  };

  const test = async (id?: string) => {
    setBusy(id ? `test:${id}` : "test");
    try {
      const r = await api<{ sent: number; queued: number; failed: number; dropped: number; devices: number }>("/api/settings/notifications/test", { method: "POST", json: id ? { id } : {} });
      if (r.sent > 0) toast(r.sent === 1 ? "Test sent. It should appear in a few seconds." : `Test sent to ${r.sent} devices.`, "ok");
      else if (r.queued > 0) toast("The push service is busy. We'll keep trying for a few minutes.", "ok");
      else toast(r.dropped > 0 ? "That device stopped accepting notifications, so it was removed." : "The push service turned the test down. Try turning notifications off and on here.", "error");
      if (r.dropped > 0) setDevices((await api<{ devices: Device[] }>("/api/settings/notifications")).devices);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't send the test.", "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (d: Device | "all") => {
    setBusy(d === "all" ? "rm:all" : `rm:${d.id}`);
    try {
      const r = await api<{ devices: Device[] }>("/api/settings/notifications/devices", { method: "DELETE", json: d === "all" ? { all: true } : { id: d.id } });
      setDevices(r.devices);
      if (d === "all" || d.current) {
        const sub = await currentSub().catch(() => null);
        await sub?.unsubscribe().catch(() => {});
        setSubscribed(false);
      }
      toast(d === "all" ? "All devices removed." : `${d.device} removed.`, "ok");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't remove it.", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="nf page-frame pb-16 pt-8 lg:pt-14">
      <Header status={status} />
      <div className="mt-8 grid max-w-6xl gap-6 lg:mt-10 lg:grid-cols-[14.5rem_minmax(0,1fr)] lg:gap-10">
        <SideNav />
        <div className="flex min-w-0 flex-col gap-5">
          <PermissionCard state={state} perm={perm} later={later} busy={busy} devices={devices} pushOn={prefs.ch.push} onEnable={enable} onLater={() => (dismiss(), setLater(true))} onDisable={disableHere} onTest={() => test()} onRecheck={refresh} onPushOn={() => save({ ch: { push: true } }, "Push notifications on.")} />

          <section id="nf-types" aria-labelledby="nf-types-h" className="nf-section">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="nf-types-h" className="nf-h2">What to notify you about</h2>
                <p className="mt-1 text-sm text-muted-foreground">Every alert comes from something Outlly confirmed: a platform&apos;s answer, a payment, a schedule.</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={saving} onClick={() => save({ all: true }, "Every notification is on.")}>Enable all</Button>
                <Button variant="outline" size="sm" disabled={saving} onClick={() => save({ all: false }, "Optional notifications are off. Essential ones stay on.")}>Disable all</Button>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-4">
              {CATEGORIES.map((c, i) => (
                <CategoryCard key={c.id} id={c.id} i={i} prefs={prefs} saving={saving} spikeAllowed={spikeAllowed} onSave={save} />
              ))}
            </div>
          </section>

          <Assistant prefs={prefs} saving={saving} onSave={save} />

          <Delivery prefs={prefs} tz={tz} saving={saving} onSave={save} onTz={async (z) => {
            const before = tz;
            setTz(z);
            try {
              await api("/api/settings/profile", { method: "PATCH", json: { timezone: z } });
              toast(`Time zone set to ${z.replace(/_/g, " ")}.`, "ok");
            } catch (err) {
              setTz(before);
              toast(err instanceof ApiError ? err.message : "Couldn't change the time zone.", "error");
            }
          }} />

          <Devices devices={devices} busy={busy} onTest={test} onRemove={remove} />
          <Preview canTest={devices.length > 0} busy={busy === "test"} onTest={() => test()} />
          <History />
        </div>
      </div>
    </div>
  );
}

/** What the switches show while the save is on its way (the server's answer replaces it). */
function optimistic(p: NotifyPrefs, patch: NotifyPatch): NotifyPrefs {
  const n: NotifyPrefs = { ...p, ev: { ...p.ev }, ch: { ...p.ch, ...patch.ch }, quiet: { ...p.quiet, ...patch.quiet }, assist: { ...p.assist, ...patch.assist, greet: { ...p.assist.greet, ...patch.assist?.greet } } };
  const set = (e: EventKey, v: boolean) => (n.ev[e] = EVENT_INFO[e].essential ? true : v);
  if (typeof patch.all === "boolean") (Object.keys(n.ev) as EventKey[]).forEach((e) => set(e, patch.all!));
  if (patch.category) CATEGORIES.find((c) => c.id === patch.category!.id)?.events.forEach((e) => set(e, patch.category!.on));
  for (const [k, v] of Object.entries(patch.ev ?? {})) set(k as EventKey, !!v);
  if (patch.lead) n.lead = patch.lead;
  return n;
}

function SideNav() {
  const [at, setAt] = useState<string>(SECTIONS[0].id);
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((es) => {
      const vis = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setAt(vis.target.id);
    }, { rootMargin: "-20% 0px -60% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return (
    <nav aria-label="Notification settings sections" className="hidden lg:block">
      <ul className="sticky top-6 space-y-0.5">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} aria-current={at === s.id ? "location" : undefined} className={cn("nf-nav", at === s.id && "is-on")}>
              <s.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
              <span className="truncate">{s.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function PermissionCard(p: { state: PushState | null; perm: string; later: boolean; busy: string | null; devices: Device[]; pushOn: boolean; onEnable: () => void; onLater: () => void; onDisable: () => void; onTest: () => void; onRecheck: () => void; onPushOn: () => void }) {
  const here = p.devices.find((d) => d.current);
  const body = (() => {
    if (p.state === null) return <div className="h-[132px]" aria-hidden="true" />;
    if (p.state === "on")
      return (
        <>
          <Lead icon={<Check className="h-6 w-6" />} tone="ok" title="You're all set!" text={p.pushOn ? `Notifications reach ${here ? `this ${here.platform === "desktop" ? "computer" : "device"} (${here.client})` : "this device"}. They also show in the bell and, for important ones, by email.` : "This device is connected, but push is switched off under Delivery, so nothing is sent to it."} />
          <div className="mt-5 flex flex-wrap gap-2">
            {p.pushOn ? (
              <Button onClick={p.onTest} disabled={p.busy === "test"}>
                <Send className="h-4 w-4" aria-hidden="true" /> {p.busy === "test" ? "Sending" : "Send test notification"}
              </Button>
            ) : (
              <Button onClick={p.onPushOn}>Turn push back on</Button>
            )}
            <Button variant="outline" onClick={p.onDisable} disabled={p.busy === "disable"}>
              <BellOff className="h-4 w-4" aria-hidden="true" /> Turn off on this device
            </Button>
          </div>
        </>
      );
    if (p.state === "ios-needs-install")
      return (
        <>
          <Lead icon={<Smartphone className="h-6 w-6" />} title="Add Outlly to your Home Screen first" text="On iPhone and iPad, notifications only reach web apps opened from the Home Screen (iOS 16.4 or later). It takes three taps:" />
          <ol className="mt-4 grid gap-2 sm:grid-cols-3">
            {[
              { i: <Share className="h-4 w-4" />, t: "Tap Share in Safari's toolbar" },
              { i: <SquarePlus className="h-4 w-4" />, t: "Choose Add to Home Screen" },
              { i: <Bell className="h-4 w-4" />, t: "Open Outlly from the icon and come back here" },
            ].map((s, k) => (
              <li key={k} className="nf-step">
                <span className="nf-step-n" aria-hidden="true">{k + 1}</span>
                <span aria-hidden="true">{s.i}</span>
                <span className="text-[14px] font-medium">{s.t}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[13px] text-muted-foreground">Until then, alerts still appear in the bell and by email.</p>
        </>
      );
    if (p.state === "unsupported")
      return <Lead icon={<CircleAlert className="h-6 w-6" />} title="This browser can't show notifications" text="Try Chrome, Edge, Firefox or Safari on a computer, Chrome on Android, or Outlly added to an iPhone's Home Screen. Alerts still appear in the bell and by email." />;
    if (p.state === "denied")
      return (
        <>
          <Lead icon={<BellOff className="h-6 w-6" />} tone="warn" title="Notifications are blocked for Outlly" text={`The browser remembers that choice, so only you can undo it. ${deniedHelp()}`} />
          <div className="mt-5">
            <Button variant="outline" onClick={p.onRecheck}>I&apos;ve allowed them, check again</Button>
          </div>
        </>
      );
    if (p.later)
      return (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px]"><span className="font-semibold">Notifications are off on this device.</span> <span className="text-muted-foreground">Alerts still reach the bell and email.</span></p>
          <Button onClick={p.onEnable} disabled={p.busy === "enable"}>{p.busy === "enable" ? "Waiting for your answer" : "Enable"}</Button>
        </div>
      );
    return (
      <>
        <Lead icon={<BellRing className="h-6 w-6" />} title="Stay in the loop with Outlly" text="Know the moment a post goes live or fails, before a scheduled post goes out, and when an account needs you. Your browser will ask once; you can change it any time." />
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={p.onEnable} disabled={p.busy === "enable"}>
            <Bell className="h-4 w-4" aria-hidden="true" /> {p.busy === "enable" ? "Waiting for your answer" : "Enable notifications"}
          </Button>
          <Button variant="ghost" onClick={p.onLater}>Not now</Button>
        </div>
      </>
    );
  })();
  return (
    <section id="nf-device" aria-label="Notifications on this device" className={cn("nf-card nf-hero p-6 sm:p-8", p.state === "on" && "is-done")} style={{ "--i": 0 } as React.CSSProperties}>
      <div key={p.state ?? "x"} className="nf-swap">{body}</div>
    </section>
  );
}

function Lead({ icon, title, text, tone }: { icon: React.ReactNode; title: string; text: string; tone?: "ok" | "warn" }) {
  return (
    <div className="flex items-start gap-4">
      <span className={cn("nf-icon", tone === "ok" && "is-ok", tone === "warn" && "is-warn")} aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <h2 className="text-[1.35rem] font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

function CategoryCard({ id, i, prefs, saving, spikeAllowed, onSave }: { id: CategoryId; i: number; prefs: NotifyPrefs; saving: boolean; spikeAllowed: boolean; onSave: (p: NotifyPatch, done?: string) => void }) {
  const c = CATEGORIES.find((x) => x.id === id)!;
  const Icon = CAT_ICON[id];
  const optional = c.events.filter((e) => !EVENT_INFO[e].essential);
  const anyOn = optional.some((e) => prefs.ev[e]) || optional.length === 0;
  const [open, setOpen] = useState(false);
  const count = c.events.filter((e) => prefs.ev[e] || EVENT_INFO[e].essential).length;
  return (
    <div className="nf-card" style={{ "--i": i + 1 } as React.CSSProperties}>
      <div className="flex items-center gap-4 p-5 sm:px-6">
        <span className="nf-icon" aria-hidden="true"><Icon className="h-5 w-5" /></span>
        <button type="button" aria-expanded={open} aria-controls={`nf-c-${id}`} onClick={() => setOpen((o) => !o)} className="nf-cat-btn min-w-0 flex-1 text-left">
          <span className="block text-[16px] font-semibold">{c.title}</span>
          <span className="block text-[13px] text-muted-foreground">{c.blurb} <span className="whitespace-nowrap">{count} of {c.events.length} on.</span></span>
        </button>
        <Switch on={anyOn} label={`All ${c.title.toLowerCase()}`} disabled={saving || optional.length === 0} onChange={(v) => onSave({ category: { id, on: v } }, `${c.title} ${v ? "on" : "off"}.`)} />
      </div>
      <Expand open={open} id={`nf-c-${id}`}>
        <div className="nf-rows border-t px-5 sm:px-6">
          {c.events.map((e) => {
            const info = EVENT_INFO[e];
            const planOff = e === "engagement_spike" && !spikeAllowed;
            return (
              <div key={e}>
                <SwitchRow id={`nf-${e}`} label={info.label} hint={planOff ? "Not on your plan. Upgrade in Billing to get spike alerts." : info.hint} on={!planOff && (prefs.ev[e] || !!info.essential)} locked={info.essential} disabled={saving || planOff} onChange={(v) => onSave({ ev: { [e]: v } }, `${info.label}: ${v ? "on" : "off"}.`)} />
                {e === "remind" && prefs.ev.remind && (
                  <div className="-mt-1 flex flex-wrap items-center gap-3 pb-3">
                    <span className="text-[14px] text-muted-foreground">Remind me</span>
                    <Choice value={prefs.lead} options={LEADS} label="Reminder time" disabled={saving} format={leadText} onChange={(v) => onSave({ lead: v }, `Reminders come ${leadText(v)}.`)} />
                  </div>
                )}
              </div>
            );
          })}
          {c.notYet?.map((n) => (
            <div key={n.label} className="py-3">
              <p className="text-[15px] font-medium text-muted-foreground">
                {n.label} <span className="ml-1 inline-flex h-5 items-center rounded-full bg-secondary px-2 align-middle text-xs font-semibold">Not available yet</span>
              </p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{n.why}</p>
            </div>
          ))}
        </div>
      </Expand>
    </div>
  );
}

function Delivery({ prefs, tz, saving, onSave, onTz }: { prefs: NotifyPrefs; tz: string; saving: boolean; onSave: (p: NotifyPatch, done?: string) => void; onTz: (z: string) => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const all = useMemo(() => (mounted ? zones(tz) : [tz]), [mounted, tz]);
  const urgent = (Object.keys(EVENT_INFO) as EventKey[]).filter((e) => EVENT_INFO[e].urgent).map((e) => EVENT_INFO[e].label.toLowerCase());
  return (
    <section id="nf-delivery" aria-labelledby="nf-delivery-h" className="nf-section">
      <h2 id="nf-delivery-h" className="nf-h2">Delivery preferences</h2>
      <div className="nf-card mt-4 px-5 sm:px-6" style={{ "--i": 6 } as React.CSSProperties}>
        <div className="nf-rows">
          <SwitchRow id="nf-ch-push" label="Push notifications" hint="On this device and every connected device below, like any app's notifications." on={prefs.ch.push} disabled={saving} onChange={(v) => onSave({ ch: { push: v } }, v ? "Push notifications on." : "Push notifications off.")} />
          <SwitchRow id="nf-ch-app" label="In-app notifications" hint="The bell in Outlly. When off, essential alerts (a lost account, a failed payment) still show there." on={prefs.ch.inApp} disabled={saving} onChange={(v) => onSave({ ch: { inApp: v } }, v ? "Bell notices on." : "Only essential notices in the bell.")} />
          <SwitchRow id="nf-ch-mail" label="Email" hint="For the alerts that send one: failed posts, reconnects, payments and renewals." on={prefs.ch.email} disabled={saving} onChange={(v) => onSave({ ch: { email: v } }, v ? "Emails on." : "Emails off.")} />
          <div>
            <SwitchRow id="nf-quiet" label="Quiet hours" hint="No push banner or sound in this window. Everything still lands in the bell." on={prefs.quiet.on} disabled={saving} onChange={(v) => onSave({ quiet: { on: v } }, v ? `Quiet from ${prefs.quiet.start} to ${prefs.quiet.end}.` : "Quiet hours off.")} />
            <Expand open={prefs.quiet.on}>
              <div className="grid gap-4 pb-3 sm:grid-cols-3">
                <TimeField label="Start" value={prefs.quiet.start} onSave={(v) => onSave({ quiet: { start: v } }, `Quiet hours start at ${v}.`)} />
                <TimeField label="End" value={prefs.quiet.end} onSave={(v) => onSave({ quiet: { end: v } }, `Quiet hours end at ${v}.`)} />
                <label className="nf-field">
                  <span>Time zone</span>
                  <select value={tz} onChange={(e) => onTz(e.target.value)}>
                    {all.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
                  </select>
                </label>
              </div>
              <p className="pb-3 text-[13px] text-muted-foreground">The time zone is your profile&apos;s, the same one your schedule uses.</p>
              <div className="border-t border-[hsl(var(--nf-line))]">
                <SwitchRow id="nf-urgent" label="Let urgent alerts through" hint={`Still notify for ${urgent.join(", ")}.`} on={prefs.quiet.urgent} disabled={saving} onChange={(v) => onSave({ quiet: { urgent: v } }, v ? "Urgent alerts come through quiet hours." : "Quiet hours hold everything.")} />
              </div>
            </Expand>
          </div>
        </div>
      </div>
    </section>
  );
}

function TimeField({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="nf-field">
      <span>{label}</span>
      <input type="time" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v && v !== value && onSave(v)} />
    </label>
  );
}

function Devices({ devices, busy, onTest, onRemove }: { devices: Device[]; busy: string | null; onTest: (id: string) => void; onRemove: (d: Device | "all") => void }) {
  return (
    <section id="nf-devices" aria-labelledby="nf-devices-h" className="nf-section">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="nf-devices-h" className="nf-h2">Connected devices</h2>
          <p className="mt-1 text-sm text-muted-foreground">Phones and browsers that get your push notifications. Remove one you no longer use.</p>
        </div>
        {devices.length > 1 && <Button variant="outline" size="sm" disabled={busy === "rm:all"} onClick={() => onRemove("all")}>Remove all</Button>}
      </div>
      <div className="nf-card mt-4" style={{ "--i": 7 } as React.CSSProperties}>
        {devices.length === 0 ? (
          <div className="flex items-center gap-4 p-6">
            <span className="nf-icon" aria-hidden="true"><Plus className="h-5 w-5" /></span>
            <p className="text-[15px] text-muted-foreground">No devices yet. Turn notifications on at the top of this page on each phone or computer you use.</p>
          </div>
        ) : (
          <ul className="nf-rows">
            {devices.map((d) => {
              const Ico = d.platform === "desktop" ? Laptop : Smartphone;
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 sm:px-6">
                  <span className="nf-icon" aria-hidden="true"><Ico className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                      {d.device}
                      {d.current && <span className="nf-chip is-lime">This device</span>}
                      <span className={cn("nf-chip", d.status === "active" ? "is-ok" : "is-warn")}>{d.status === "active" ? "Active" : "Not reaching it"}</span>
                    </p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      {d.client} · {d.platform === "ios" ? "iOS" : d.platform === "android" ? "Android" : "Computer"} · Last active {ago(d.lastActiveAt)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" disabled={busy === `test:${d.id}`} onClick={() => onTest(d.id)} aria-label={`Send a test to ${d.device}`}>
                      <Send className="h-4 w-4" aria-hidden="true" /> Test
                    </Button>
                    <Button variant="ghost" size="sm" disabled={busy === `rm:${d.id}`} onClick={() => onRemove(d)} aria-label={`Remove ${d.device}`}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

const PREVIEWS = [
  { label: "Publishing", title: "Post Published", body: "Your Instagram post is live now." },
  { label: "Schedule", title: "Upcoming Post", body: "Your YouTube post goes live in 15 minutes." },
  { label: "Account", title: "Account Disconnected", body: "Your Instagram account needs reconnection." },
];

function Preview({ canTest, busy, onTest }: { canTest: boolean; busy: boolean; onTest: () => void }) {
  return (
    <section id="nf-preview" aria-labelledby="nf-preview-h" className="nf-section">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="nf-preview-h" className="nf-h2">Preview</h2>
          <p className="mt-1 text-sm text-muted-foreground">How alerts look on a phone or computer. These three are samples; the test sends a real one.</p>
        </div>
        <Button onClick={onTest} disabled={!canTest || busy}>
          <Send className="h-4 w-4" aria-hidden="true" /> {busy ? "Sending" : "Send test notification"}
        </Button>
      </div>
      <ul className="mt-4 grid gap-3 md:grid-cols-3" aria-label="Sample notifications">
        {PREVIEWS.map((p, i) => (
          <li key={p.title} className="nf-preview" style={{ "--i": i } as React.CSSProperties}>
            <span className="nf-chip mb-2">{p.label} sample</span>
            <div className="nf-toast">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/app/icon-192.png" alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-[9px]" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"><span>Outlly</span><span className="normal-case tracking-normal">now</span></p>
                <p className="mt-0.5 text-[15px] font-semibold leading-snug">{p.title}</p>
                <p className="text-[14px] leading-snug text-muted-foreground">{p.body}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {!canTest && <p className="mt-3 text-[13px] text-muted-foreground">Turn notifications on for a device to send a test.</p>}
    </section>
  );
}

/**
 * 1141 section 19: the assistant's own nudges. Kept apart from the switches above on purpose: those are
 * about the creator's accounts and money, these are Outlly speaking for itself, and somebody who wants one
 * and not the other should not have to hunt. The greeting times are fixed so the copy can name them.
 */
function Assistant({ prefs, saving, onSave }: { prefs: NotifyPrefs; saving: boolean; onSave: (p: NotifyPatch, done?: string) => void }) {
  const a = prefs.assist;
  const said = (label: string, on: boolean) => `${label} ${on ? "on" : "off"}.`;
  return (
    <section id="nf-assist" aria-labelledby="nf-assist-h" className="nf-section">
      <div>
        <h2 id="nf-assist-h" className="nf-h2">Your assistant</h2>
        <p className="mt-1 text-sm text-muted-foreground">Nudges from Outlly itself, timed to your own time zone. Nothing here is about your accounts, so it has its own switches.</p>
      </div>
      <div className="nf-card mt-4 px-5 sm:px-6" style={{ "--i": 4 } as React.CSSProperties}>
        <SwitchRow
          id="nf-idle"
          label="Nudge me when I have been away"
          hint="After 30 minutes, a day, three days and a week away. One nudge each step, never a pile of them."
          on={a.inactivity}
          onChange={(v) => onSave({ assist: { inactivity: v } }, said("Away nudges", v))}
          disabled={saving}
        />
        <SwitchRow
          id="nf-growth"
          label="Growth tips"
          hint="A suggestion when your own numbers show something worth doing, like a time of day that keeps working."
          on={a.growth}
          onChange={(v) => onSave({ assist: { growth: v } }, said("Growth tips", v))}
          disabled={saving}
        />
        <SwitchRow
          id="nf-summary"
          label="One summary when things get busy"
          hint="When several alerts land close together, Outlly sends one summary instead of buzzing for each."
          on={a.summary}
          onChange={(v) => onSave({ assist: { summary: v } }, said("Summaries", v))}
          disabled={saving}
        />
        <div className="border-t border-border/60 py-4">
          <p className="text-[15px] font-medium leading-snug">Greetings</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">A short hello with what is really on for the day, read from your calendar. Pick the times you want one.</p>
          <div className="mt-1 grid gap-x-8 sm:grid-cols-2">
            {GREET_SLOTS.map((s) => (
              <SwitchRow key={s} id={`nf-greet-${s}`} label={GREET_LABEL[s]} on={a.greet[s]} onChange={(v) => onSave({ assist: { greet: { [s]: v } } }, said(GREET_LABEL[s].split(",")[0], v))} disabled={saving} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function History() {
  const toast = useToast();
  const [items, setItems] = useState<Notice[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [tab, setTab] = useState<CentreTab>("all");
  const head = useRef<HTMLHeadingElement>(null);
  const load = useCallback(() => {
    api<{ notices: Notice[]; unread: number }>("/api/notices?history=1")
      .then((r) => {
        setItems(r.notices);
        setUnread(r.unread);
        setBadge(r.unread);
      })
      .catch(() => setItems((x) => x ?? []));
  }, []);
  useEffect(() => {
    load();
    window.addEventListener("outlly:notices", load);
    return () => window.removeEventListener("outlly:notices", load);
  }, [load]);
  const act = async (method: "PATCH" | "DELETE", ids: string[] | "all") => {
    const before = items;
    const hit = (n: Notice) => ids === "all" || ids.includes(n.id);
    setItems((xs) => xs && (method === "DELETE" ? xs.filter((n) => !hit(n)) : xs.map((n) => (hit(n) ? { ...n, read: true } : n))));
    setUnread((u) => (ids === "all" ? 0 : Math.max(0, u - (before ?? []).filter((n) => hit(n) && !n.read).length)));
    if (method === "DELETE") head.current?.focus();
    try {
      await api("/api/notices", { method, json: ids === "all" ? { all: true } : { ids } });
      window.dispatchEvent(new Event("outlly:notices"));
    } catch (err) {
      setItems(before);
      toast(err instanceof ApiError ? err.message : "Something got in the way.", "error");
    }
  };
  // 1141: the notification centre's groups. The filter is here and not in the request: the history is one
  // short list already, and a tab that answers instantly is worth more than a round trip.
  const shown = useMemo(() => (items ?? []).filter((n) => tab === "all" || centreTabOf(n.kind) === tab), [items, tab]);
  return (
    <section id="nf-history" aria-labelledby="nf-history-h" className="nf-section">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="nf-history-h" ref={head} tabIndex={-1} className="nf-h2 outline-none">History</h2>
          <p className="mt-1 text-sm text-muted-foreground">{unread > 0 ? `${unread} unread.` : "All caught up."} Cleared alerts don&apos;t come back as new.</p>
        </div>
        {items && items.length > 0 && (
          <div className="flex gap-2">
            {unread > 0 && <Button variant="outline" size="sm" onClick={() => act("PATCH", "all")}>Mark all read</Button>}
            <Button variant="outline" size="sm" onClick={() => act("DELETE", "all")}>Clear all</Button>
          </div>
        )}
      </div>
      {items && items.length > 0 && (
        <div role="tablist" aria-label="Filter notifications" className="nf-tabs mt-4">
          {CENTRE_TABS.map((t) => {
            const n = items.filter((x) => t.id === "all" || centreTabOf(x.kind) === t.id).length;
            if (!n && t.id !== "all") return null;
            return (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("nf-tab", tab === t.id && "is-on")}>
                {t.title}
                <span className="nf-tab-n">{n}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="nf-card mt-4" style={{ "--i": 8 } as React.CSSProperties}>
        {items === null ? (
          <div className="space-y-3 p-6" aria-hidden="true">{[0, 1, 2].map((k) => <div key={k} className="nf-skel h-12" />)}</div>
        ) : shown.length === 0 ? (
          <p className="p-6 text-[15px] text-muted-foreground">{items.length === 0 ? "Nothing here yet. Alerts you get will be listed here." : "Nothing in this group."}</p>
        ) : (
          <ul className="nf-rows">
            {shown.map((n) => (
              <li key={n.id} className="flex items-start gap-3 px-5 py-4 sm:px-6">
                <span aria-hidden="true" className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-lime")} />
                <div className="min-w-0 flex-1">
                  {n.href ? (
                    <Link href={n.href} onClick={() => !n.read && act("PATCH", [n.id])} className="nf-hist-link">
                      {!n.read && <span className="sr-only">Unread. </span>}
                      <span className={cn("text-[15px] leading-snug", n.read ? "font-medium" : "font-semibold")}>{n.title}</span>
                    </Link>
                  ) : (
                    <p className={cn("text-[15px] leading-snug", n.read ? "font-medium" : "font-semibold")}>
                      {!n.read && <span className="sr-only">Unread. </span>}
                      {n.title}
                    </p>
                  )}
                  <p className="mt-0.5 text-[14px] text-muted-foreground">{n.body}</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">{ago(n.createdAt)}</p>
                </div>
                <div className="flex shrink-0">
                  {!n.read && (
                    <button type="button" className="nf-icon-btn" aria-label={`Mark "${n.title}" read`} onClick={() => act("PATCH", [n.id])}>
                      <Check className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                  <button type="button" className="nf-icon-btn" aria-label={`Clear "${n.title}"`} onClick={() => act("DELETE", [n.id])}>
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-3 flex items-center gap-2 text-[13px] text-muted-foreground">
        <Moon className="h-3.5 w-3.5" aria-hidden="true" /> Alerts held back by quiet hours are still listed here.
      </p>
    </section>
  );
}
