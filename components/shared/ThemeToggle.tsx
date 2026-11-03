"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_KEY } from "@/lib/theme/script";
import { THEME_COOKIE, THEME_COOKIE_AGE, THEME_SWITCH_MS } from "@/lib/theme/colors";
import { isIosHomeScreenApp, syncStatusBar } from "@/lib/theme/statusbar";
import { cn } from "@/lib/utils";

export type ThemeChoice = "light" | "dark" | "system";

type ViewTransitionDoc = Document & { startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> } };
let fallback = 0;
// which switch is the latest: an older transition finishing late must not clear a newer one's flag
let seq = 0;

/**
 * Paint a theme (1105). `animate` is for a change someone made (a tap, the OS switching for System, another tab),
 * never the first paint: the head script did that already, with no motion.
 * 1. The status bar colour (meta theme-color) goes first; phones repaint it at once.
 * 2. The page then changes as ONE cross-fade of everything, header, rails, cards, borders and icons together,
 *    for THEME_SWITCH_MS on cubic-bezier(0.16, 1, 0.3, 1) (View Transitions: Chrome and Android 111+, Safari 18+).
 *    Older browsers get the same timing as a colour-only transition (html.theme-anim in globals.css).
 * Reduced motion switches instantly. A second call for the theme already showing is a no-op, so the several
 * theme controls that each listen for the OS change never paint twice.
 */
function apply(choice: ThemeChoice, animate = false) {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const el = document.documentElement;
  // theme-color tags + Android app bar icons, for the exact page background of this theme (lib/theme/statusbar.ts)
  syncStatusBar(dark);
  el.dataset.theme = choice;
  if (el.classList.contains("dark") === dark) return;
  const paint = () => {
    el.classList.toggle("dark", dark);
  };
  if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return paint();
  const doc = document as ViewTransitionDoc;
  if (typeof doc.startViewTransition === "function") {
    const n = ++seq;
    el.dataset.themeSwitch = "";
    const done = () => {
      if (n === seq) delete el.dataset.themeSwitch;
    };
    const t = doc.startViewTransition(paint);
    // a second quick switch skips this one: its ready promise rejects, which is expected, not an error
    t.ready.catch(() => {});
    t.finished.then(done, done);
    return;
  }
  el.classList.add("theme-anim");
  paint();
  window.clearTimeout(fallback);
  fallback = window.setTimeout(() => el.classList.remove("theme-anim"), THEME_SWITCH_MS + 60);
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
  // the server reads this to send the matching status bar colour with the next page (1107, lib/theme/colors.ts)
  document.cookie = `${THEME_COOKIE}=${choice};path=/;max-age=${THEME_COOKIE_AGE};samesite=lax${location.protocol === "https:" ? ";secure" : ""}`;
  const before = document.documentElement.dataset.tc;
  apply(choice, true);
  window.dispatchEvent(new CustomEvent<ThemeChoice>(THEME_EVENT, { detail: choice }));
  // 1108: an iPhone Home Screen app keeps the status bar colour it read when the page loaded and ignores later
  // changes, so the strip stayed the old theme's colour. Once the cross-fade ends, reload: the server reads the
  // cookie above and sends the new colour in the first HTML. Compared after the fade, when the dark class has
  // flipped, so a colour read from the screen (the first-launch welcome) is the new one too.
  if (isIosHomeScreenApp()) {
    window.setTimeout(() => {
      if (syncStatusBar() !== before) window.location.reload();
    }, THEME_SWITCH_MS + 60);
  }
}

export function useTheme() {
  // Server and first client render agree on "dark"; the real choice (already on html[data-theme] from the head
  // script) is read before paint, so a light user never sees the moon icon for a frame (review 1103).
  const [choice, setChoice] = useState<ThemeChoice>("dark");
  useLayoutEffect(() => setChoice((document.documentElement.dataset.theme as ThemeChoice) || stored()), []);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => stored() === "system" && apply("system", true);
    const onSet = (e: Event) => setChoice((e as CustomEvent<ThemeChoice>).detail);
    // another tab changed it: follow along
    const onStore = (e: StorageEvent) => {
      if (e.key !== THEME_KEY) return;
      const c = (e.newValue as ThemeChoice) || "dark";
      setChoice(c);
      apply(c, true);
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
