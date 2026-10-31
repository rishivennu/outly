"use client";
/**
 * Animated icons (1080), from lucide-animated (MIT, see LICENSE.md). Same drawings as lucide-react, so they
 * sit beside the static ones without a style change. The PARENT plays them: `useIconPlay()` gives a ref for
 * the icon and handlers for the link or button around it, so hovering or focusing the whole row plays it,
 * not just the 18px glyph. Under reduced motion nothing plays; the icon stays a still drawing.
 */
import { useCallback, useRef, type ComponentType, type HTMLAttributes, type RefAttributes } from "react";
import { HomeIcon } from "./home";
import { PlusIcon } from "./plus";
import { LayoutGridIcon } from "./layout-grid";
import { CalendarDaysIcon } from "./calendar-days";
import { ChartLineIcon } from "./chart-line";
import { MessageCircleIcon } from "./message-circle";
import { ClipboardCheckIcon } from "./clipboard-check";
import { Link2Icon } from "./link-2";
import { CreditCardIcon } from "./credit-card";
import { CircleHelpIcon } from "./circle-help";
import { SettingsIcon } from "./settings";
import { EarthIcon } from "./earth";
import { LogoutIcon } from "./logout";
import { EyeIcon } from "./eye";
import { HeartIcon } from "./heart";
import { SendIcon } from "./send";
import { GaugeIcon } from "./gauge";
import { RotateCCWIcon } from "./rotate-ccw";
import { ShieldCheckIcon } from "./shield-check";

export type IconHandle = { startAnimation: () => void; stopAnimation: () => void };
export type AnimatedIcon = ComponentType<HTMLAttributes<HTMLSpanElement> & { size?: number } & RefAttributes<IconHandle>>;

export const ANIMATED = {
  home: HomeIcon,
  plus: PlusIcon,
  content: LayoutGridIcon,
  calendar: CalendarDaysIcon,
  analytics: ChartLineIcon,
  inbox: MessageCircleIcon,
  approvals: ClipboardCheckIcon,
  accounts: Link2Icon,
  billing: CreditCardIcon,
  help: CircleHelpIcon,
  settings: SettingsIcon,
  website: EarthIcon,
  logout: LogoutIcon,
  views: EyeIcon,
  interactions: HeartIcon,
  posts: SendIcon,
  engagement: GaugeIcon,
  replay: RotateCCWIcon,
  security: ShieldCheckIcon,
} as unknown as Record<string, AnimatedIcon>;
export type AnimatedName = keyof typeof ANIMATED;

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Ref for the icon, handlers for its row. Leaving the row lets the animation finish its loop back to rest. */
export function useIconPlay() {
  const ref = useRef<IconHandle>(null);
  const play = useCallback(() => {
    if (!reduced()) ref.current?.startAnimation();
  }, []);
  const rest = useCallback(() => ref.current?.stopAnimation(), []);
  return { ref, handlers: { onMouseEnter: play, onMouseLeave: rest, onFocus: play, onBlur: rest }, play };
}

/** An animated icon by name, decorative (the row carries the label). */
export function AnimIcon({ name, size = 18, className, iconRef }: { name: string; size?: number; className?: string; iconRef?: React.Ref<IconHandle> }) {
  const Icon = ANIMATED[name] ?? ANIMATED.home;
  return <Icon ref={iconRef} size={size} aria-hidden="true" className={className} />;
}
