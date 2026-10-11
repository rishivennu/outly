"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_KEY } from "@/lib/theme/script";
import { cn } from "@/lib/utils";

export type ThemeChoice = "light" | "dark" | "system";

function apply(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const el = document.documentElement;
  el.classList.toggle("dark", dark);
  el.dataset.theme = choice;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0c0c0e" : "#faf8f3");
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  useEffect(() => {
    setChoice(((localStorage.getItem(THEME_KEY) as ThemeChoice) || "system"));
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => (localStorage.getItem(THEME_KEY) || "system") === "system" && apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const set = (c: ThemeChoice) => {
    localStorage.setItem(THEME_KEY, c);
    setChoice(c);
    apply(c);
  };
  return { choice, set };
}

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/** Segmented Light / Dark / System control. `compact` hides labels (icons keep aria-labels). */
export function ThemeToggle({ compact = false, plain = false, className }: { compact?: boolean; plain?: boolean; className?: string }) {
  const { choice, set } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className={cn("inline-flex items-center gap-0.5 rounded-full p-1", plain ? "bg-secondary/60" : "glass", className)}>
      {OPTIONS.map(({ value, label, Icon }) => {
        const on = choice === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={label}
            onClick={() => set(value)}
            className={cn(
              "inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full px-2.5 text-sm transition-colors",
              on ? "lime-bg lime-ring font-medium" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {!compact && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
