"use client";
import { useEffect, useState } from "react";
import { Moon, Sun, Sunrise, Sunset, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type DayPart = "night" | "morning" | "afternoon" | "evening";

/** Hour (0-23, device clock) to a part of the day. Pure, so it is unit-tested. */
export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

const COPY: Record<DayPart, { hello: string; icon: LucideIcon; tint: string }> = {
  morning: { hello: "Good morning", icon: Sunrise, tint: "text-amber-600 dark:text-amber-300" },
  afternoon: { hello: "Good afternoon", icon: Sun, tint: "text-orange-600 dark:text-orange-300" },
  evening: { hello: "Good evening", icon: Sunset, tint: "text-rose-600 dark:text-rose-300" },
  night: { hello: "Working late", icon: Moon, tint: "text-indigo-600 dark:text-indigo-300" },
};

export function greetingFor(hour: number, name?: string) {
  const c = COPY[dayPart(hour)];
  return name ? `${c.hello}, ${name}` : c.hello;
}

/**
 * "Good morning, Tej" from the visitor's own clock. Server HTML says "Hey Tej" (the server
 * cannot know the visitor's local time), then the greeting swaps in after hydration with a
 * soft fade. The pill keeps its height, so nothing below it moves.
 */
export function Greeting({ name, className }: { name?: string; className?: string }) {
  const [part, setPart] = useState<DayPart | null>(null);
  useEffect(() => {
    const tick = () => setPart(dayPart(new Date().getHours()));
    tick();
    const t = setInterval(tick, 5 * 60_000);
    return () => clearInterval(t);
  }, []);
  const c = part ? COPY[part] : null;
  const Icon = c?.icon ?? Sun;
  return (
    <p className={cn("greeting-pill", className)} aria-live="polite">
      <Icon className={cn("h-4 w-4 shrink-0 transition-opacity duration-500", c ? cn("opacity-100", c.tint) : "opacity-0")} aria-hidden="true" />
      <span className="truncate">
        {c ? c.hello : "Hey"}
        {name ? <>, <span className="font-semibold text-foreground">{name}</span></> : null}
      </span>
    </p>
  );
}
