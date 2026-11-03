"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_KEY } from "@/lib/theme/script";
import { cn } from "@/lib/utils";

export type ThemeChoice = "light" | "dark" | "system";

function apply(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const el = document.documentElement;
  el.classList.toggle("dark", dark);
  el.dataset.theme = choice;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? "#0c0c0e" : "#f5f7fa"));
}

/** Every theme control on the page listens for this, so the rail, top bar, menus and palette never disagree (1103). */
export const THEME_EVENT = "outlly:theme";

const stored = (): ThemeChoice => {
  try {
    return (localStorage.getItem(THEME_KEY) as ThemeChoice) || "dark";
  } catch {
    return "dark";
  }
};

/** Save, apply and announce a theme. The one way to change it (palette commands use it too). */
export function setTheme(choice: ThemeChoice) {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {}
  apply(choice);
  window.dispatchEvent(new CustomEvent<ThemeChoice>(THEME_EVENT, { detail: choice }));
}

export function useTheme() {
  // Server and first client render agree on "dark"; the real choice (already on html[data-theme] from the head
  // script) is read before paint, so a light user never sees the moon icon for a frame (review 1103).
  const [choice, setChoice] = useState<ThemeChoice>("dark");
  useLayoutEffect(() => setChoice((document.documentElement.dataset.theme as ThemeChoice) || stored()), []);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => stored() === "system" && apply("system");
    const onSet = (e: Event) => setChoice((e as CustomEvent<ThemeChoice>).detail);
    // another tab changed it: follow along
    const onStore = (e: StorageEvent) => {
      if (e.key !== THEME_KEY) return;
      const c = (e.newValue as ThemeChoice) || "dark";
      setChoice(c);
      apply(c);
    };
    mq.addEventListener("change", onChange);
    window.addEventListener(THEME_EVENT, onSet);
    window.addEventListener("storage", onStore);
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener(THEME_EVENT, onSet);
      window.removeEventListener("storage", onStore);
    };
  }, []);
  return { choice, set: setTheme };
}

export const THEME_OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/**
 * Segmented Light / Dark / System control. `compact` hides labels (icons keep aria-labels).
 * A real radio group (1103 review): one Tab stop on the current choice, arrows and Home/End pick and move focus.
 * The account menu leaves arrows inside a radiogroup to it.
 */
export function ThemeToggle({ compact = false, plain = false, className }: { compact?: boolean; plain?: boolean; className?: string }) {
  const { choice, set } = useTheme();
  const group = useRef<HTMLDivElement>(null);
  const pick = (i: number) => {
    const n = THEME_OPTIONS[(i + THEME_OPTIONS.length) % THEME_OPTIONS.length]!;
    set(n.value);
    group.current?.querySelector<HTMLElement>(`[data-v="${n.value}"]`)?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = THEME_OPTIONS.findIndex((o) => o.value === choice);
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: THEME_OPTIONS.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    pick(to);
  };
  return (
    <div ref={group} role="radiogroup" aria-label="Theme" onKeyDown={onKeyDown} className={cn("inline-flex items-center gap-0.5 rounded-full p-1", plain ? "bg-secondary/60" : "glass", className)}>
      {THEME_OPTIONS.map(({ value, label, Icon }) => {
        const on = choice === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            data-v={value}
            tabIndex={on ? 0 : -1}
            aria-checked={on}
            aria-label={label}
            title={label}
            onClick={() => set(value)}
            className={cn(
              "inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full px-2.5 text-sm transition-colors",
              // icon-only: 44px wide, and the hit area reaches 4px above and below into the group's padding, so 44 x 44
              compact && "relative min-w-11 before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']",
              on ? "bg-foreground font-medium text-background" : "text-muted-foreground hover:text-foreground",
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

export const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = { light: "dark", dark: "system", system: "light" };

/** One 44px button that cycles Light > Dark > System. For tight bars (the phone top bar, 1103). */
export function ThemeCycleButton({ className }: { className?: string }) {
  const { choice, set } = useTheme();
  const cur = THEME_OPTIONS.find((o) => o.value === choice) ?? THEME_OPTIONS[1];
  const nxt = THEME_OPTIONS.find((o) => o.value === NEXT_THEME[choice])!;
  return (
    <button
      type="button"
      onClick={() => set(nxt.value)}
      aria-label={`Theme: ${cur.label}. Switch to ${nxt.label}`}
      title={`Theme: ${cur.label}`}
      className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground", className)}
    >
      <cur.Icon className="h-[18px] w-[18px]" aria-hidden />
    </button>
  );
}
