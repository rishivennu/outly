"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Compass, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUser } from "@/components/shell/UserContext";
import { useToast } from "@/components/shared/Toast";
import { GoogleHelp } from "./GoogleHelp";
import { startTour, tourKey } from "./Tour";
import { cn } from "@/lib/utils";

export type SetupState = {
  connected: { instagram: boolean; youtube: boolean };
  instagram: { oauth: boolean; token: boolean };
  youtube: { oauth: boolean };
};

const hiddenKey = (id: string) => `outly:setup-hidden:${id}`;

const NOTICES: Record<string, { text: string; tone: "ok" | "info" | "error" }> = {
  no_channel: { text: "You're signed in. That Google account has no YouTube channel yet; create one on youtube.com, then connect it here.", tone: "info" },
  channel_later: { text: "You're signed in. YouTube didn't link this time; try Sign in with Google again from the checklist.", tone: "info" },
};

/** First-run checklist on Home: the five steps from sign-up to a connected, toured studio. */
export function SetupChecklist({ state }: { state: SetupState }) {
  const user = useUser();
  const toast = useToast();
  const [ready, setReady] = useState(false);
  const [toured, setToured] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const key = tourKey(user.id);
    setToured(!!localStorage.getItem(key));
    setHidden(!!localStorage.getItem(hiddenKey(user.id)));
    setReady(true);

    const q = new URLSearchParams(location.search);
    const welcome = q.get("welcome") === "1";
    const notice = q.get("notice");
    if (q.get("connected") === "youtube") toast(welcome ? "Welcome to Outly. Your YouTube channel is linked." : "YouTube channel linked.", "ok");
    else if (welcome) toast("Welcome to Outly. Your account is ready.", "ok");
    if (notice && NOTICES[notice]) toast(NOTICES[notice].text, NOTICES[notice].tone);
    if (welcome || notice || q.has("connected")) {
      ["welcome", "notice", "connected"].forEach((k) => q.delete(k));
      history.replaceState(null, "", location.pathname + (q.toString() ? `?${q}` : ""));
    }

    // First visit ever on this device: open the tour once. Closing it counts as done.
    let t: ReturnType<typeof setTimeout> | undefined;
    if ((welcome || !localStorage.getItem(key)) && q.get("tour") !== "1") t = setTimeout(startTour, 600);
    const onClosed = () => setToured(!!localStorage.getItem(key));
    window.addEventListener("outly:tour-closed", onClosed);
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener("outly:tour-closed", onClosed);
    };
  }, [user.id, toast]);

  const { connected } = state;
  const steps = [
    { id: "account", title: "Create your Outly account", done: true, body: "Done. You're in." },
    { id: "instagram", title: "Connect Instagram", done: connected.instagram },
    { id: "youtube", title: "Sign in with Google to link YouTube", done: connected.youtube },
    { id: "403", title: "If Google shows Error 403, get tester access", done: connected.youtube },
    { id: "tour", title: "Take the guided tour", done: toured },
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
    if (id === "403") return <GoogleHelp compact className="w-full" />;
    if (id === "tour")
      return (
        <Button size="sm" variant="outline" onClick={() => startTour()}>
          <Compass className="h-4 w-4" aria-hidden="true" /> Start the tour
        </Button>
      );
    return null;
  };

  const notes: Record<string, string> = {
    instagram: "You log in on Instagram's own page and pick the account. Outly never sees your password. Needs a professional (Business or Creator) account.",
    youtube: "Pick your Gmail on Google's page; the channel on that account links automatically.",
    "403": "Google limits unverified apps to approved testers. This is a one-time fix.",
    tour: "One minute: posting, the calendar, live analytics, the inbox and approvals.",
  };

  return (
    <section aria-labelledby="setup-h" className="mx-auto max-w-5xl px-5 pb-6 sm:px-10">
      <div className="glass rounded-[32px] p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow mb-1.5">Getting started</p>
            <h2 id="setup-h" className="text-xl font-semibold tracking-tight">Set up Outly in five steps</h2>
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
