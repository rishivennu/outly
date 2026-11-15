"use client";
import { BarChart3, CalendarClock, Captions, Clock, Filter, ListChecks, Send, Upload, Users } from "lucide-react";
import type { OnboardingStepId } from "@/lib/onboarding-core";

type Explore = Extract<OnboardingStepId, "create" | "schedule" | "analytics">;

/** A short look at a page before going there. The page's own tips (guides.ts) take over once it opens. */
export const EXPLORE: Record<Explore, { intro: string; href: string; cta: string; points: { icon: typeof Upload; text: string }[] }> = {
  create: {
    intro: "One video in, a post for every platform out. Here is how a post comes together.",
    href: "/create?tips=1",
    cta: "Upload your first video",
    points: [
      { icon: Upload, text: "Upload a video or photo. Outlly checks the format and size each platform accepts." },
      { icon: Captions, text: "Add captions and subtitles, edit them line by line, or let AI transcribe where it is available." },
      { icon: Send, text: "Write a caption for each platform, then publish now or save it as a draft." },
    ],
  },
  schedule: {
    intro: "Pick a time and Outlly sends the post for you, even with this tab closed.",
    href: "/calendar?tips=1",
    cta: "Open the calendar",
    points: [
      { icon: Clock, text: "Choose a date and time in the composer. Times are in your own time zone." },
      { icon: CalendarClock, text: "The calendar shows what goes out when. Drag a post to another day to move it." },
      { icon: ListChecks, text: "Every post shows where it stands: draft, scheduled, published or failed." },
    ],
  },
  analytics: {
    intro: "See how your posts are doing, with numbers straight from each platform.",
    href: "/analytics?tips=1",
    cta: "Open analytics",
    points: [
      { icon: BarChart3, text: "Views and engagement for each connected account and your best posts." },
      { icon: Filter, text: "Filter by platform, and look at the last 7, 30 or 90 days." },
      { icon: Users, text: "Audience details show up where the platform shares them." },
    ],
  },
};

export function ExploreStep({ id }: { id: Explore }) {
  const e = EXPLORE[id];
  return (
    <div>
      <p className="text-[15px] leading-relaxed text-muted-foreground">{e.intro}</p>
      <ul className="mt-4 flex flex-col gap-2">
        {e.points.map((p) => (
          <li key={p.text} className="flex gap-3 rounded-2xl bg-secondary/40 p-3">
            <p.icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm leading-relaxed">{p.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
