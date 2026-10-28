"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useUser } from "@/components/shell/UserContext";
import { Spotlight, type Stop } from "./Spotlight";
import { resetGuides, tourState } from "./guides";

/*
 * Welcome tour: a spotlight that walks the real navigation, Home to Settings, one short line per page.
 * Each page then explains itself the first time it's opened (PageGuide.tsx).
 * Targets are `data-tour` names, so the sidebar (desktop) and the bottom bar (mobile) both work;
 * a page that lives under More on a phone points at More.
 */

/** owner: only the studio owner has this page (teammates don't see Accounts or Billing). */
// The whole studio, Home to Settings, one short line each: a first look, not a manual.
const STOP_LIST: Stop[] = [
  { title: "Welcome to Outlly", body: "A quick look around, from Home to Settings. Arrow keys move, Esc leaves any time." },
  // Benefits step (1037): what changes for you, before the where-is-what.
  {
    title: "What you get",
    body: "One upload does the work of three. Here's what Outlly takes off your plate.",
    points: [
      "Captions, hooks and titles drafted for each platform",
      "Posts go out on time, even with your laptop shut",
      "Every result tracked per platform in one place",
      "Run several accounts and switch in one tap on Pro Manager",
    ],
  },
  { target: "home", title: "Home", body: "Your day at a glance: what's going out, what needs you, and your weekly goal." },
  { target: "new-post", title: "Create a post", body: "Drop one video. Outlly drafts a caption for each platform, and you approve every word before it goes out." },
  { target: "content", title: "Content", body: "Every video and post you've made: drafts, scheduled, sent and failed, in one place." },
  { target: "calendar", title: "Calendar", body: "See what goes out when. Drag a post to another day, or plan a batch of up to 10." },
  { target: "analytics", title: "Analytics", body: "Live numbers for each connected account: views, reach and your best posts." },
  { target: "inbox", title: "Inbox", body: "Comments and messages from your platforms in one list, with suggested replies." },
  { target: "approvals", title: "Approvals", body: "Want a client or teammate to check a post first? Send them a review link. Nothing goes out until it's cleared." },
  { target: "accounts", owner: true, title: "Connected accounts", body: "Connect Instagram, YouTube and the rest here. You sign in on their own pages, so Outlly never sees your password." },
  { target: "billing", owner: true, title: "Billing", body: "Your plan, invoices and upgrades." },
  { target: "support", title: "Help centre", body: "Guides and answers, or write to us. Our replies show up here too." },
  { target: "settings", title: "Settings", body: "Your profile, two-step sign-in and team. Each page also shows a few tips the first time you open it." },
];

const ALL_STOPS = (teammate: boolean) => (teammate ? STOP_LIST.filter((s) => !s.owner) : STOP_LIST);

const EVENT = "outly:tour";
export const tourKey = (userId: string) => `outly:tour-done:${userId}`;
export function startTour() {
  window.dispatchEvent(new Event(EVENT));
}

export function Tour() {
  const user = useUser();
  const stops = ALL_STOPS(!!user.workspace);
  const [run, setRun] = useState(0); // 0 = closed; a new number restarts from the first stop

  const close = useCallback(() => {
    localStorage.setItem(tourKey(user.id), new Date().toISOString());
    setRun(0);
    tourState.open = false;
    window.dispatchEvent(new Event("outly:tour-closed"));
  }, [user.id]);

  useEffect(() => {
    const open = () => {
      // Taking the tour (again) brings every page's tips back too.
      resetGuides(user.id);
      tourState.open = true;
      tourState.ranOn = location.pathname;
      setRun((n) => n + 1);
    };
    const pause = () => {
      tourState.open = false;
      setRun(0);
    };
    window.addEventListener(EVENT, open);
    window.addEventListener("outly:tour-pause", pause);
    // Through the event, so Pip, the update notice and page tips all hear the tour start too
    // (next tick: their listeners mount after this one).
    let deep = 0;
    if (new URLSearchParams(location.search).get("tour") === "1") deep = window.setTimeout(startTour, 0);
    return () => {
      window.clearTimeout(deep);
      window.removeEventListener(EVENT, open);
      window.removeEventListener("outly:tour-pause", pause);
    };
  }, [user.id]);

  if (!run) return null;
  return (
    <Spotlight
      key={run}
      label="Guided tour"
      stops={stops}
      moreFallback
      onClose={close}
      finish={(done, ref) => (
        <>
          {!user.workspace && (
            <Link href="/accounts" onClick={done} className="inline-flex min-h-[44px] items-center rounded-full px-4 text-sm font-medium hover:bg-secondary">
              Connect
            </Link>
          )}
          <Link href="/create" ref={ref} onClick={done} className="lime-bg inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-5 text-sm font-semibold">
            New post <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </>
      )}
    />
  );
}
