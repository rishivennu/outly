"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BellRing, Check, Share, SquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUser } from "@/components/shell/UserContext";
import { useToast } from "@/components/shared/Toast";
import { ONBOARDING_CHANGED, openOnboarding, saveOnboarding } from "./onboarding-client";
import { installMode, provenInstalled, type InstallMode } from "@/lib/pwa-core";
import { permission } from "@/lib/client/push";
import { SETUP_COOKIE_DAYS, SETUP_DEVICE_COOKIE, SETUP_HIDDEN_COOKIE, setupHiddenFor, withSetupHidden, type OnboardingPayload, type OnboardingStepId } from "@/lib/onboarding-core";
import { cn } from "@/lib/utils";

const COUNT = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

const hiddenKey = (id: string) => `outly:setup-hidden:${id}`;

const readCookie = (name: string) => document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
const writeCookie = (name: string, value: string) => {
  document.cookie = `${name}=${value}; Path=/; Max-Age=${SETUP_COOKIE_DAYS * 86_400}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
};

/**
 * 1136: the last two steps of setting up, and the two that decide whether anything Outlly sends is ever
 * seen. Both are read from the browser, never from the server: an installed app and a granted permission
 * are facts about this device, and the checklist must not claim either on a device where it is not true.
 * A browser that cannot install Outlly at all (a desktop without the prompt, an in-app browser) is not
 * shown the step, because there would be nothing to do about it.
 */
function deviceSetup() {
  const standalone = (q: string) => window.matchMedia?.(q).matches ?? false;
  const installed = provenInstalled({
    standalone: standalone("(display-mode: standalone)") || standalone("(display-mode: fullscreen)") || standalone("(display-mode: minimal-ui)") || standalone("(display-mode: window-controls-overlay)"),
    iosStandalone: (navigator as Navigator & { standalone?: boolean }).standalone === true,
    appMode: document.documentElement.hasAttribute("data-app"),
    referrer: document.referrer,
  });
  const mode = installMode({ ua: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints, hasPrompt: !!(window as Window & { __outllyInstall?: unknown }).__outllyInstall });
  return { installed, mode, perm: permission() };
}

const NOTICES: Record<string, { text: string; tone: "ok" | "info" | "error" }> = {
  no_channel: { text: "You're signed in. That Google account has no YouTube channel yet; create one on youtube.com, then connect it here.", tone: "info" },
  channel_later: { text: "You're signed in. YouTube didn't link this time; try Sign in with Google again from the checklist.", tone: "info" },
};

/** What each guided step is for, under its title while it is still open. */
const NOTES: Record<OnboardingStepId, string> = {
  welcome: "A one-minute hello, and the tour if you want it.",
  connect: "You log in on each platform's own page. Outlly never sees your password.",
  profile: "Your name, what you make, a picture and your links.",
  create: "Upload a video, add captions, and get it ready for each platform.",
  schedule: "Pick a time and Outlly sends it for you, even with this tab closed.",
  analytics: "Views, engagement and audience, by platform and date range.",
};

/**
 * First-run checklist on Home. Phase 2: the six guided steps come from the account (OnboardingFlow saves them),
 * so the list reads the same on every device; each row opens the flow at that step. The install and
 * notification rows stay facts about this device.
 * Perf (CLS): rendered by the server with the account's steps. `hidden` and `deviceOpen` come from the cookies in
 * lib/onboarding-core.ts. The device rows join inside the card after hydration, into a reserved row, so the card
 * grows or shrinks by one row at most and never drops in from nothing above the dashboard.
 */
export function SetupChecklist({ onboarding, hidden: hiddenOnServer = false, deviceOpen = null }: { onboarding: OnboardingPayload; hidden?: boolean; deviceOpen?: boolean | null }) {
  const user = useUser();
  const toast = useToast();
  const [view, setView] = useState(onboarding);
  const [hidden, setHidden] = useState(hiddenOnServer);
  const [device, setDevice] = useState<{ installed: boolean; mode: InstallMode; perm: string } | null>(null);
  const [installing, setInstalling] = useState(false);

  // This device's own two facts, kept fresh: the browser may offer the install prompt a moment after load,
  // and the notification permission can change in another tab or in the browser's own settings.
  useEffect(() => {
    const read = () => {
      const d = deviceSetup();
      setDevice(d);
      // Remembered for the server, so the next Home reserves the row only when it will be used.
      const open = (!!(d.mode || d.installed) && !d.installed) || (d.perm !== "unsupported" && d.perm !== "granted");
      try {
        if (readCookie(SETUP_DEVICE_COOKIE) !== (open ? "1" : "0")) writeCookie(SETUP_DEVICE_COOKIE, open ? "1" : "0");
      } catch {
        /* cookies blocked: the row is simply reserved each time */
      }
    };
    read();
    window.addEventListener("outly:installable", read);
    window.addEventListener("outly:installed", read);
    window.addEventListener("focus", read);
    return () => {
      window.removeEventListener("outly:installable", read);
      window.removeEventListener("outly:installed", read);
      window.removeEventListener("focus", read);
    };
  }, []);

  useEffect(() => setView(onboarding), [onboarding]);
  useEffect(() => {
    const on = (e: Event) => setView((e as CustomEvent<OnboardingPayload>).detail);
    window.addEventListener(ONBOARDING_CHANGED, on);
    return () => window.removeEventListener(ONBOARDING_CHANGED, on);
  }, []);

  useEffect(() => {
    try {
      // Hidden before the cookie existed: carry it over, so from the next visit the server already knows.
      if (localStorage.getItem(hiddenKey(user.id)) && !setupHiddenFor(readCookie(SETUP_HIDDEN_COOKIE), user.id)) {
        writeCookie(SETUP_HIDDEN_COOKIE, withSetupHidden(readCookie(SETUP_HIDDEN_COOKIE), user.id));
        setHidden(true);
      }
    } catch {
      /* storage blocked: the server's answer stands */
    }

    const q = new URLSearchParams(location.search);
    const welcome = q.get("welcome") === "1";
    const notice = q.get("notice");
    if (q.get("connected") === "youtube") toast(welcome ? "Welcome to Outlly. Your YouTube channel is linked." : "YouTube channel linked.", "ok");
    else if (welcome) toast("Welcome to Outlly. Your account is ready.", "ok");
    if (notice && NOTICES[notice]) toast(NOTICES[notice].text, NOTICES[notice].tone);
    if (welcome || notice || q.has("connected")) {
      ["welcome", "notice", "connected"].forEach((k) => q.delete(k));
      history.replaceState(null, "", location.pathname + (q.toString() ? `?${q}` : ""));
    }
    // The first-run walk-through itself (and the tour) is OnboardingFlow's now, in the same order as before.
  }, [user.id, toast]);

  const guided = view.finished ? [] : view.steps;
  const steps = [
    ...guided.map((g) => ({ id: g.id as string, title: g.title, done: g.status === "done", skipped: g.status === "skipped" })),
    ...(device && (device.mode || device.installed) ? [{ id: "install", title: "Add Outlly to your home screen", done: device.installed, skipped: false }] : []),
    ...(device && device.perm !== "unsupported" ? [{ id: "notify", title: "Turn on notifications", done: device.perm === "granted", skipped: false }] : []),
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const open = (s: { done: boolean; skipped: boolean }) => !s.done && !s.skipped;
  // Before hydration nobody knows this device's two rows: keep one row's room unless last visit said there were none.
  // Only when a past visit said a device row will show: a first visit reserves nothing, so nothing has to shrink.
  const reserve = device === null && deviceOpen === true;

  if (hidden || !(steps.some(open) || (device === null && deviceOpen === true))) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(hiddenKey(user.id), "1");
      writeCookie(SETUP_HIDDEN_COOKIE, withSetupHidden(readCookie(SETUP_HIDDEN_COOKIE), user.id));
    } catch {
      /* storage blocked: hidden for this visit */
    }
    setHidden(true);
    // Hiding the list ends the guided setup on the account too, so no other device brings it back.
    if (!view.finished) saveOnboarding({ action: "dismiss" }).catch(() => {});
  };

  const action = (id: string, skipped: boolean) => {
    if (guided.some((g) => g.id === id))
      return (
        <Button size="sm" variant={skipped ? "outline" : "primary"} className="min-h-11" onClick={() => openOnboarding(id as OnboardingStepId)}>
          {skipped ? "Pick it up again" : id === "welcome" ? "Start" : "Open this step"} <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      );
    if (id === "install") {
      if (device?.mode === "prompt")
        return (
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            disabled={installing}
            onClick={async () => {
              const w = window as Window & { __outllyInstall?: { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> } | null };
              const ev = w.__outllyInstall;
              if (!ev) return toast("Your browser took the install prompt back. Use its own menu to add Outlly.", "info");
              setInstalling(true);
              try {
                await ev.prompt();
                const { outcome } = await ev.userChoice;
                w.__outllyInstall = null; // a prompt can only be used once
                if (outcome === "accepted") setDevice(deviceSetup());
              } catch {
                toast("That did not open. Use your browser's menu to add Outlly.", "info");
              } finally {
                setInstalling(false);
              }
            }}
          >
            <SquarePlus className="h-4 w-4" aria-hidden="true" /> Add to home screen
          </Button>
        );
      return (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Share className="h-4 w-4 shrink-0" aria-hidden="true" /> Tap Share, then &quot;Add to Home Screen&quot;.
        </p>
      );
    }
    if (id === "notify")
      return (
        <Button asChild size="sm" variant={device?.perm === "denied" ? "outline" : "primary"} className="min-h-11">
          <Link href="/settings/notifications#nf-device">
            <BellRing className="h-4 w-4" aria-hidden="true" /> {device?.perm === "denied" ? "See how to unblock them" : "Turn on notifications"}
          </Link>
        </Button>
      );
    return null;
  };

  const notes: Record<string, string> = {
    ...NOTES,
    install: "Outlly opens like an app, full screen, and on an iPhone this is what lets notifications reach you at all.",
    notify: device?.perm === "denied" ? "Your browser is blocking notifications. Only you can undo that, and the settings page shows where." : "A comment, a reply, a post going out or failing: you hear about it while it still matters.",
  };

  return (
    <section aria-labelledby="setup-h" className="page-frame pb-6">
      <div className="glass rounded-[32px] p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow mb-1.5">Getting started</p>
            <h2 id="setup-h" className="text-xl font-semibold tracking-tight">{guided.length ? `Set up Outlly in ${COUNT[steps.length] ?? steps.length} steps` : "Finish setting up this device"}</h2>
          </div>
          <Button size="icon-sm" variant="ghost" onClick={dismiss} aria-label="Hide the setup checklist" className="h-11 w-11 shrink-0">
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Setup progress">
            <div className="lime-bg h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${steps.length ? (doneCount / steps.length) * 100 : 0}%` }} />
          </div>
          <span className="text-sm tabular-nums text-muted-foreground">{steps.length > 0 ? `${doneCount} of ${steps.length}` : "\u00a0"}</span>
        </div>
        <ol className="mt-5 flex flex-col gap-2">
          {steps.map((s, i) => (
            <li key={s.id} className={cn("flex gap-3.5 rounded-2xl p-3", !s.done && "bg-secondary/40")}>
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                  s.done ? "lime-bg" : "hairline text-muted-foreground",
                )}
              >
                {s.done ? <Check className="h-3.5 w-3.5" /> : String(i + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("font-medium", s.done && "text-muted-foreground")}>
                  {s.title}
                  <span className="sr-only">{s.done ? " (done)" : s.skipped ? " (skipped)" : " (to do)"}</span>
                  {s.skipped && <span aria-hidden="true" className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">Skipped</span>}
                </p>
                {!s.done && (
                  <>
                    {notes[s.id] && <p className="mt-0.5 text-sm text-muted-foreground">{notes[s.id]}</p>}
                    <div className="mt-2.5">{action(s.id, s.skipped)}</div>
                  </>
                )}
              </div>
            </li>
          ))}
          {/* The height of one open device row (title, note, button), filled in by the real rows after hydration. */}
          {reserve && <li aria-hidden="true" data-setup-reserve="" className="min-h-[124px] rounded-2xl bg-secondary/40" />}
        </ol>
      </div>
    </section>
  );
}
