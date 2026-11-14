"use client";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import * as Tooltip from "@radix-ui/react-tooltip";
import { PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { NEXT_THEME, THEME_OPTIONS, ThemeToggle, useTheme } from "@/components/shared/ThemeToggle";
import { OrbAvatar } from "@/components/brand/OrbAvatar";
import { OutlyMark } from "@/components/brand/Logo";
import { AnimIcon, useIconPlay } from "@/components/icons/animated";
import { HoverLink } from "./HoverLink";
import { NoticesBell } from "./NoticesBell";
import { SignOutButton } from "./SignOutButton";
import { openPalette } from "./CommandPalette";
import { AccountMenu, useWho } from "./AccountMenu";
import { ANIM, GLIDE, MAIN, RAIL_KEY, TOUR, isActive, workspaceItems } from "./nav-items";

const RailOpen = createContext(false);

/** Label on hover or focus while the rail is icons only; nothing once the labels are showing. */
function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  const expanded = useContext(RailOpen);
  const [open, setOpen] = useState(false);
  return (
    <Tooltip.Root open={open && !expanded} onOpenChange={setOpen}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="right" sideOffset={14} className="rail-tip">
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function Row({ href, label, active }: { href: string; label: string; active: boolean }) {
  const ic = useIconPlay();
  return (
    <Tip label={label}>
      <HoverLink href={href} data-tour={TOUR[href]} aria-current={active ? "page" : undefined} {...ic.handlers} className="rail-row">
        {active && <motion.span layoutId="rail-pill" className="rail-pill" transition={GLIDE} />}
        <span className="rail-ic">
          <AnimIcon name={ANIM[href] ?? "home"} size={20} iconRef={ic.ref} />
        </span>
        <span className="rail-label">{label}</span>
      </HoverLink>
    </Tip>
  );
}

/**
 * Marks the rail's scroll box with data-scrolling while it moves and for a moment after (1064), so its slim
 * scrollbar (.nav-scroll, shown only while the rail is open) can show a little more in use and fade when idle.
 */
function useScrolling() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = () => {
      if (!el.hasAttribute("data-scrolling")) el.setAttribute("data-scrolling", "");
      if (t) clearTimeout(t);
      t = setTimeout(() => el.removeAttribute("data-scrolling"), 800);
    };
    el.addEventListener("scroll", on, { passive: true });
    return () => {
      el.removeEventListener("scroll", on);
      if (t) clearTimeout(t);
    };
  }, []);
  return ref;
}

/**
 * Theme in the rail (1103). Icons only: one 44px button showing the current theme, which cycles
 * Light > Dark > System (the tooltip names it). Open: a "Theme" row with the three-way switch, so any choice is
 * one click. CSS shows one or the other from html[data-rail], so the hidden one is out of the Tab order.
 */
function RailTheme() {
  const { choice, set } = useTheme();
  const cur = THEME_OPTIONS.find((o) => o.value === choice) ?? THEME_OPTIONS[1];
  const nxt = THEME_OPTIONS.find((o) => o.value === NEXT_THEME[choice])!;
  return (
    <>
      <Tip label={`Theme: ${cur.label}`}>
        <button type="button" onClick={() => set(nxt.value)} aria-label={`Theme: ${cur.label}. Switch to ${nxt.label}`} className="rail-row rail-theme-cycle">
          <span className="rail-ic">
            <cur.Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
          </span>
        </button>
      </Tip>
      <div className="rail-theme">
        <span aria-hidden="true">Theme</span>
        <ThemeToggle compact plain className="shrink-0" />
      </div>
    </>
  );
}

/**
 * The studio sidebar (1100; every dashboard style since 1103): a slim rail, fully rounded, icons only. A lime circle marks where you
 * are and glides between sections; the profile sits in a light circle near the bottom and opens the account
 * menu; logout is last. The toggle widens it to show labels, and the page column takes back the space when it
 * narrows. The choice is kept per device (localStorage) and applied before paint, so navigating never jumps.
 *
 * Brand colours only, following the page theme (1103): a light glass rail with ink icons in light, the ink rail
 * with cream icons in dark, a lime selection in both. Theme sits above the bell; Outlly website is in the account
 * menu. It replaced the classic sidebar in 1103, with the same links, order and tour targets.
 */
export function PulseRail() {
  const path = usePathname();
  const who = useWho();
  const [open, setOpen] = useState(false);
  const plus = useIconPlay();
  const out = useIconPlay();
  const settle = useRef(0);
  const scroller = useScrolling();
  // Before paint (the head script already set the width), so the toggle icon and tooltips never lag a frame.
  useLayoutEffect(() => setOpen(document.documentElement.getAttribute("data-rail") === "open"), []);
  useEffect(() => () => window.clearTimeout(settle.current), []);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) document.documentElement.setAttribute("data-rail", "open");
    else document.documentElement.removeAttribute("data-rail");
    try {
      localStorage.setItem(RAIL_KEY, next ? "open" : "closed");
    } catch {}
    // Charts and tables that measure themselves re-fit once the width has settled.
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 360);
  };
  const studio = MAIN.filter((m) => m.href !== "/create");
  const lower = workspaceItems(who.teammate);
  return (
    <RailOpen.Provider value={open}>
      <Tooltip.Provider delayDuration={150} skipDelayDuration={400}>
        <div className="rail-wrap sticky top-0 hidden h-dvh shrink-0 p-3 lg:block">
          <aside id="pulse-rail" data-route-order="" data-shell="pulse" aria-label="Primary" className="rail lg-glass">
            <div className="rail-top">
              <HoverLink href="/home" className="rail-row rail-logo" aria-label="Outlly dashboard">
                <span className="rail-disc">
                  <OutlyMark size={22} />
                </span>
                <span className="rail-label rail-word">outlly</span>
              </HoverLink>
              <Tip label={open ? "Collapse sidebar" : "Expand sidebar"}>
                <button type="button" onClick={toggle} aria-expanded={open} aria-controls="pulse-rail" aria-label={open ? "Collapse sidebar" : "Expand sidebar"} className="rail-row">
                  <span className="rail-ic">{open ? <PanelLeftClose className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" /> : <PanelLeftOpen className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />}</span>
                  <span className="rail-label">Collapse</span>
                </button>
              </Tip>
              <Tip label="New post">
                <HoverLink href="/create" data-tour="new-post" aria-current={isActive(path, "/create") ? "page" : undefined} {...plus.handlers} className="rail-row rail-new">
                  {isActive(path, "/create") && <motion.span layoutId="rail-pill" className="rail-pill" transition={GLIDE} />}
                  <span className="rail-ic">
                    <AnimIcon name="plus" size={20} iconRef={plus.ref} />
                  </span>
                  <span className="rail-label">New post</span>
                </HoverLink>
              </Tip>
              <Tip label="Search">
                <button type="button" onClick={openPalette} aria-label="Search or jump" aria-keyshortcuts="Control+K Meta+K" className="rail-row">
                  <span className="rail-ic">
                    <Search className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
                  </span>
                  <span className="rail-label">Search</span>
                </button>
              </Tip>
            </div>

            <div ref={scroller} data-lenis-prevent className="rail-mid nav-scroll">
              <nav className="rail-group" aria-label="Studio">
                {studio.map(({ href, label }) => <Row key={href} href={href} label={label} active={isActive(path, href)} />)}
              </nav>
              <div className="rail-sep" aria-hidden="true" />
              <div className="rail-group" role="group" aria-label="Workspace">
                {lower.map(({ href, label }) => <Row key={href} href={href} label={label} active={isActive(path, href)} />)}
              </div>
            </div>

            <div className="rail-bottom">
              <RailTheme />
              <NoticesBell placement="side" className="rail-bell" />
              <AccountMenu>
                <button type="button" aria-label={`Account menu, ${who.name}`} className="rail-row rail-me">
                  <span className="rail-avatar">
                    <OrbAvatar avatar={who.avatar} seed={who.email} size={34} />
                  </span>
                  <span className="rail-label min-w-0">
                    <span className="block truncate text-[14px] font-semibold text-foreground">{who.name}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">{who.sub}</span>
                  </span>
                </button>
              </AccountMenu>
              <Tip label="Log out">
                <SignOutButton {...out.handlers} aria-label="Log out" className="rail-row rail-out">
                  <span className="rail-ic">
                    <AnimIcon name="logout" size={20} iconRef={out.ref} />
                  </span>
                  <span className="rail-label">Log out</span>
                </SignOutButton>
              </Tip>
            </div>
          </aside>
        </div>
      </Tooltip.Provider>
    </RailOpen.Provider>
  );
}
