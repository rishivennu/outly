"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BellRing, CalendarPlus, Check, Compass, Share, SquarePlus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUser } from "@/components/shell/UserContext";
import { useToast } from "@/components/shared/Toast";
import { startTour, tourKey } from "./Tour";
import { installMode, provenInstalled, type InstallMode } from "@/lib/pwa-core";
import { permission } from "@/lib/client/push";
import { readConsent } from "@/components/shared/CookieConsent";
import { afterPrivacy, privacyPending } from "@/components/shared/PrivacyNotice";
import { cn } from "@/lib/utils";

export type SetupState = {
  connected: { instagram: boolean; youtube: boolean };
  instagram: { oauth: boolean; token: boolean };
  youtube: { oauth: boolean };
  /** 1076: at least one file in the media library */
  uploaded: boolean;
  /** 1076: at least one post has left draft (published or scheduled) */
  scheduled: boolean;
};

const COUNT = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

const hiddenKey = (id: string) => `outly:setup-hidden:${id}`;

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

/** First-run checklist on Home: sign-up to a first post on the calendar, connected and toured on the way. */
export function SetupChecklist({ state }: { state: SetupState }) {
  const user = useUser();
  const toast = useToast();
  const [ready, setReady] = useState(false);
  const [toured, setToured] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [device, setDevice] = useState<{ installed: boolean; mode: InstallMode; perm: string } | null>(null);
  const [installing, setInstalling] = useState(false);

  // This device's own two facts, kept fresh: the browser may offer the install prompt a moment after load,
  // and the notification permission can change in another tab or in the browser's own settings.
  useEffect(() => {
    const read = () => setDevice(deviceSetup());
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

  useEffect(() => {
    const key = tourKey(user.id);
    setToured(!!localStorage.getItem(key));
    setHidden(!!localStorage.getItem(hiddenKey(user.id)));
    setReady(true);

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

    // First visit ever on this device: open the tour once. Closing it counts as done.
    // One thing at a time: the cookie question comes first, the tour after it is answered.
    // Then the privacy notice, then the tour.
    let t: ReturnType<typeof setTimeout> | undefined;
    let unPrivacy = () => {};
    // Straight away when nothing is in front of it; a beat for the privacy notice's exit when it was.
    const begin = () => {
      const waited = privacyPending(user.id);
      unPrivacy = afterPrivacy(user.id, () => { t = setTimeout(() => startTour(), waited ? 160 : 0); });
    };
    const wantsTour = (welcome || !localStorage.getItem(key)) && q.get("tour") !== "1";
    const consented = !!readConsent();
    if (wantsTour && consented) begin();
    else if (wantsTour) window.addEventListener("outly:consent", begin, { once: true });
    const onClosed = () => setToured(!!localStorage.getItem(key));
    window.addEventListener("outly:tour-closed", onClosed);
    return () => {
      if (t) clearTimeout(t);
      unPrivacy();
      window.removeEventListener("outly:consent", begin);
      window.removeEventListener("outly:tour-closed", onClosed);
    };
  }, [user.id, toast]);

  const { connected } = state;
  const steps = [
    { id: "account", title: "Create your Outlly account", done: true, body: "Done. You're in." },
    { id: "instagram", title: "Connect Instagram", done: connected.instagram },
    { id: "youtube", title: "Sign in with Google to link YouTube", done: connected.youtube },
    { id: "upload", title: "Upload your first video or photo", done: state.uploaded },
    { id: "schedule", title: "Schedule your first post", done: state.scheduled },
    { id: "tour", title: "Take the guided tour", done: toured },
    ...(device && (device.mode || device.installed) ? [{ id: "install", title: "Add Outlly to your home screen", done: device.installed }] : []),
    ...(device && device.perm !== "unsupported" ? [{ id: "notify", title: "Turn on notifications", done: device.perm === "granted" }] : []),
  ];
  const doneCount = steps.filter((s) => s.done).length;

  if (!ready || hidden || doneCount === steps.length) return null;

  const dismiss = () => {
    localStorage.setItem(hiddenKey(user.id), "1");
    setHidden(true);
  };

  const action = (id: string) => {
    if (id === "instagram") {
      if (state.instagram.oauth)
        return (
          <Button asChild size="sm" variant="primary">
            <a href="/api/accounts/instagram/connect?returnTo=/home">Log in with Instagram <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
          </Button>
        );
      if (state.instagram.token)
        return (
          <Button asChild size="sm" variant="outline">
            <Link href="/accounts">Connect with an access token <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </Button>
        );
      return <p className="text-sm text-muted-foreground">Instagram login isn&apos;t set up on this server yet. The owner needs to add the Instagram app keys.</p>;
    }
    if (id === "youtube") {
      if (state.youtube.oauth)
        return (
          <Button asChild size="sm" variant="primary">
            <a href="/api/accounts/youtube/connect?returnTo=/home">Sign in with Google <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
          </Button>
        );
      return <p className="text-sm text-muted-foreground">Google sign-in isn&apos;t set up on this server yet.</p>;
    }
    if (id === "upload")
      return (
        <Button asChild size="sm" variant={connected.instagram || connected.youtube ? "primary" : "outline"}>
          <Link href="/create"><Upload className="h-4 w-4" aria-hidden="true" /> Upload a file</Link>
        </Button>
      );
    if (id === "schedule")
      return (
        <Button asChild size="sm" variant={state.uploaded ? "primary" : "outline"}>
          <Link href="/create"><CalendarPlus className="h-4 w-4" aria-hidden="true" /> Write and schedule a post</Link>
        </Button>
      );
    if (id === "tour")
      return (
        <Button size="sm" variant="outline" onClick={() => startTour()}>
          <Compass className="h-4 w-4" aria-hidden="true" /> Start the tour
        </Button>
      );
    if (id === "install") {
      if (device?.mode === "prompt")
        return (
          <Button
            size="sm"
            variant="outline"
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
        <Button asChild size="sm" variant={device?.perm === "denied" ? "outline" : "primary"}>
          <Link href="/settings/notifications#nf-device">
            <BellRing className="h-4 w-4" aria-hidden="true" /> {device?.perm === "denied" ? "See how to unblock them" : "Turn on notifications"}
          </Link>
        </Button>
      );
    return null;
  };

  const notes: Record<string, string> = {
    instagram: "You log in on Instagram's own page and pick the account. Outlly never sees your password. Needs a professional (Business or Creator) account.",
    youtube: "Pick your Gmail on Google's page; the channel on that account links automatically.",
    upload: "Drag a video or photo into the composer. It stays in your media library for later posts too.",
    schedule: "Pick a time on the composer, or post now. Outlly sends it for you, even with this tab closed.",
    tour: "One minute: posting, the calendar, live analytics, the inbox and approvals.",
    install: "Outlly opens like an app, full screen, and on an iPhone this is what lets notifications reach you at all.",
    notify: device?.perm === "denied" ? "Your browser is blocking notifications. Only you can undo that, and the settings page shows where." : "A comment, a reply, a post going out or failing: you hear about it while it still matters.",
  };

  return (
    <section aria-labelledby="setup-h" className="page-frame pb-6">
      <div className="glass rounded-[32px] p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow mb-1.5">Getting started</p>
            <h2 id="setup-h" className="text-xl font-semibold tracking-tight">Set up Outlly in {COUNT[steps.length] ?? steps.length} steps</h2>
          </div>
          <Button size="icon-sm" variant="ghost" onClick={dismiss} aria-label="Hide the setup checklist" className="h-11 w-11">
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Setup progress">
            <div className="lime-bg h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          <span className="text-sm tabular-nums text-muted-foreground">{doneCount} of {steps.length}</span>
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
                  <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
                </p>
                {!s.done && (
                  <>
                    {notes[s.id] && <p className="mt-0.5 text-sm text-muted-foreground">{notes[s.id]}</p>}
                    <div className="mt-2.5">{action(s.id)}</div>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
