"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, BookOpen, LayoutDashboard, Presentation, Send, Sparkles, Tag, Workflow } from "lucide-react";
import { LiquidNavbar, NimbusIcons, type LiquidNavItem } from "@/components/ui/liquid-glass-navbar";
import { OutlyLogo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { AnimatedLink } from "@/components/ui/animated-link";
import { FlipText } from "@/components/ui/text-fx";
import { cn } from "@/lib/utils";
import { loadGsap, type GsapApi } from "@/lib/motion/gsap-lazy";
import { GSAP_EASE, sec } from "@/lib/motion/tokens";
import { reduced } from "@/lib/motion/prefs";
import { scrollPageTo } from "@/lib/motion/smooth";
import { useSignedIn } from "./useSignedIn";
import { joinHref, useWaitlist } from "./useWaitlist";
import { useHiddenSections } from "./useHiddenSections";

/**
 * R1307: the public site's header, rebuilt around the Nimbus UI "Waterline" liquid navbar
 * (components/ui/liquid-glass-navbar.tsx, kept verbatim: WebGL water, droplet indicator, ripples, icon scenes and the
 * CSS-drop fallback). Three floating glass pills share one row and one height: the brand on the left, the water pill
 * with the section links in the centre, and the actions (theme, log in, the lime call to action) on the right.
 *
 * Scrolling down past SPLIT_AT splits the row: the water pill fades out, the secondary actions fold away, the brand
 * glides to the top-left edge of the screen and the call to action to the top-right, each in its own glass pill.
 * Scrolling back up (UP px of travel, or reaching the top) glides them home and the water pill returns. Direction and
 * travel thresholds keep a jittery wheel from flipping it; a click on a section link holds the full bar while the page
 * glides there. GSAP drives the move (lazy, lib/motion/gsap-lazy.ts, like the menus before it); reduced motion jumps
 * between the two states instead. The water pauses on its own when the pill leaves the screen or is hidden (display
 * none while split), and it falls back to a CSS drop when WebGL is missing or its context is lost.
 *
 * Below lg the water pill is not rendered at all (no WebGL on phones); a glass menu pill opens a drawer (Radix Dialog)
 * with the same links, log in and the theme switch. The split still happens on phones: the call to action goes left,
 * the brand slides over to sit beside the menu pill on the right.
 *
 * Links: the landing sections glide through the one scroll engine (lib/motion/smooth.ts, Lenis) and keep the hash in
 * the URL; Resources and Contact are routes. The active item follows the section whose top has crossed 40% of the
 * viewport (Home above the first one) and, off the landing page, the route. Admin-hidden sections (useHiddenSections)
 * drop out of the pill. Waitlist mode relabels the call to action (useWaitlist, joinHref); a signed-in visitor gets
 * Dashboard instead of Log in + Get started (useSignedIn). components/marketing/Nav.tsx is the bar this replaced.
 */
type NavEntry = LiquidNavItem & { href: string; sec?: string; routes?: RegExp; gate?: string };

const ico = (Icon: typeof Sparkles) => <Icon size={18} strokeWidth={1.8} aria-hidden="true" />;

export const NAV: NavEntry[] = [
  { label: "Home", href: "/", icon: NimbusIcons.home, fx: "glow" },
  { label: "How it works", href: "/#how", sec: "how", icon: ico(Workflow), fx: "spin" },
  { label: "Features", href: "/#features", sec: "features", icon: ico(Sparkles), fx: "pop" },
  { label: "Pricing", href: "/#pricing", sec: "pricing", icon: ico(Tag), fx: "drop" },
  { label: "Resources", href: "/help", routes: /^\/(help|blog|changelog)(\/|$)/, icon: ico(BookOpen), fx: "wave", gate: "resources" },
  { label: "Workshops", href: "/workshops", routes: /^\/workshops(\/|$)/, icon: ico(Presentation), fx: "pop", gate: "workshops" },
  { label: "Contact", href: "/contact", routes: /^\/contact(\/|$)/, icon: ico(Send), fx: "plane" },
];
const PARTNERS = { href: "/partners", label: "Partner with us" };

/** Thresholds for the split (px). Reached on the way down, the row splits; on the way up it joins again. */
export const SPLIT = { at: 160, join: 72, down: 24, up: 40, gap: 8 } as const;
/** How long a click on a section link holds the full bar while the page glides there. */
const HOLD_MS = 1200;

/** Is the dark theme on? Read from the html class before paint, then followed through the theme switch. */
function useIsDark() {
  const [dark, setDark] = useState(true); // server and first client render agree on the site default
  useLayoutEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.classList.contains("dark"));
    read();
    const mo = new MutationObserver(read);
    mo.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

/** lg and up. True until measured, so the server markup is the desktop one and hydration matches it. */
function useDesktop() {
  const [desk, setDesk] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setDesk(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desk;
}

const MOD = (e: React.MouseEvent) => e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;

export function LiquidNav() {
  const pathname = usePathname();
  const router = useRouter();
  const signedIn = useSignedIn();
  const waitlist = useWaitlist();
  const hidden = useHiddenSections(pathname);
  const dark = useIsDark();
  const desktop = useDesktop();
  const items = useMemo(() => NAV.filter((n) => (!n.sec || !hidden.has(n.sec)) && (!n.gate || !hidden.has(n.gate))), [hidden]); // gate: R1310 admin page switches

  const [active, setActive] = useState(0);
  const [split, setSplit] = useState(false);
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const brandRef = useRef<HTMLDivElement>(null);
  const waterRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const secRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const gsapRef = useRef<GsapApi | null>(null);
  const splitRef = useRef(false);
  const activeRef = useRef(0);
  const openRef = useRef(false);
  const lockUntil = useRef(0);
  const clicked = useRef(-1); // the item a pointer picked, so onChange can tell a click from an arrow key
  openRef.current = open;

  /* ---- the split: measured from layout (offsets, never transformed rects), then tweened ---- */
  const apply = useCallback((next: boolean, instant: boolean) => {
    const g = gsapRef.current;
    const header = headerRef.current, row = rowRef.current, brand = brandRef.current, actions = actionsRef.current;
    if (!g || !header || !row || !brand || !actions) return;
    const water = waterRef.current, secondary = secRef.current, menu = menuRef.current;
    const now = instant || reduced();
    const hr = header.getBoundingClientRect();
    const cs = getComputedStyle(header);
    const left = hr.left + (parseFloat(cs.paddingLeft) || 0);
    const right = hr.right - (parseFloat(cs.paddingRight) || 0);
    const rr = row.getBoundingClientRect();
    const menuW = menu && menu.offsetParent ? menu.offsetWidth + SPLIT.gap : 0;
    const bx = next ? left - (rr.left + brand.offsetLeft) : 0;
    const ax = next ? right - menuW - (rr.left + actions.offsetLeft + actions.offsetWidth) : 0;
    const travel = now ? 0 : sec("card");
    const fade = now ? 0 : sec("nav");
    g.to(brand, { x: bx, duration: travel, ease: GSAP_EASE.out, overwrite: "auto" });
    g.to(actions, { x: ax, duration: travel, ease: GSAP_EASE.out, overwrite: "auto" });
    if (water) {
      if (next) {
        g.to(water, { autoAlpha: 0, scale: 0.94, duration: fade, ease: GSAP_EASE.in, overwrite: "auto", onComplete: () => { if (splitRef.current) water.style.display = "none"; } });
      } else {
        water.style.display = ""; // back in layout first, so the pill measures itself while it fades in
        g.to(water, { autoAlpha: 1, scale: 1, duration: travel, ease: GSAP_EASE.out, overwrite: "auto" });
      }
    }
    if (secondary && (secondary.offsetParent || secondary.style.width === "0px")) {
      // width and its 4px gap (mr-1) go together, so the compact pill keeps the same 6px padding on both sides
      if (next) g.to(secondary, { width: 0, marginRight: 0, autoAlpha: 0, duration: fade, ease: GSAP_EASE.in, overwrite: "auto" });
      else g.to(secondary, { width: "auto", marginRight: 4, autoAlpha: 1, duration: travel, ease: GSAP_EASE.out, overwrite: "auto", clearProps: "width,marginRight" });
    }
  }, []);

  const go = useCallback((next: boolean, instant = false) => {
    splitRef.current = next;
    setSplit(next);
    apply(next, instant);
  }, [apply]);

  useEffect(() => {
    let dead = false;
    void loadGsap()
      .then((g) => {
        if (dead) return;
        gsapRef.current = g;
        apply(splitRef.current, true); // a page opened mid-scroll is already split
      })
      .catch(() => {});
    return () => {
      dead = true;
      const g = gsapRef.current;
      gsapRef.current = null;
      if (!g) return;
      for (const el of [brandRef.current, actionsRef.current, waterRef.current, secRef.current]) if (el) g.killTweensOf(el);
    };
  }, [apply]);

  // The viewport or the pills' contents changed (the count of actions, a sign-in): re-place the split pills at once.
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    let raf = 0;
    const replace = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { if (splitRef.current) apply(true, true); });
    };
    const ro = new ResizeObserver(replace);
    ro.observe(header);
    if (actionsRef.current) ro.observe(actionsRef.current);
    if (brandRef.current) ro.observe(brandRef.current);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [apply]);

  /* ---- scroll: direction with thresholds for the split, the 40% line for the active section ---- */
  useEffect(() => {
    let raf = 0;
    let lastY = window.scrollY;
    let dir = 0;
    let acc = 0;
    const tick = () => {
      raf = 0;
      const y = window.scrollY;
      const dy = y - lastY;
      lastY = y;
      const held = Date.now() < lockUntil.current;
      const d = dy > 0 ? 1 : dy < 0 ? -1 : 0;
      if (d && d !== dir) { dir = d; acc = 0; }
      acc = held ? 0 : acc + Math.abs(dy);
      let next = splitRef.current;
      if (y < SPLIT.join) next = false;
      else if (!held && dir > 0 && y > SPLIT.at && acc > SPLIT.down) next = true;
      else if (!held && dir < 0 && acc > SPLIT.up) next = false;
      if (next !== splitRef.current && !openRef.current) go(next);
      if (pathname !== "/" || held) return;
      const line = window.innerHeight * 0.4;
      let cur = 0;
      items.forEach((it, i) => {
        if (!it.sec) return;
        const el = document.getElementById(it.sec);
        if (el && el.getBoundingClientRect().top <= line) cur = i;
      });
      if (cur !== activeRef.current) { activeRef.current = cur; setActive(cur); }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(tick); };
    tick();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [pathname, items, go]);

  // A new page starts at its top: whole bar, drawer shut, and the item that names the route (Home when none does).
  useEffect(() => {
    setOpen(false);
    if (splitRef.current) go(false, true);
    if (pathname === "/") return;
    const i = Math.max(0, items.findIndex((it) => it.routes?.test(pathname ?? "")));
    activeRef.current = i;
    setActive(i);
  }, [pathname, items, go]);

  /* ---- navigation ---- */
  const navigate = useCallback((href: string) => {
    const hash = href === "/" ? "" : href.startsWith("/#") ? href.slice(2) : null;
    if (hash !== null && pathname === "/") {
      lockUntil.current = Date.now() + HOLD_MS;
      const el = hash ? document.getElementById(hash) : null;
      const y = el ? window.scrollY + el.getBoundingClientRect().top - (parseFloat(getComputedStyle(el).scrollMarginTop) || 0) : 0;
      scrollPageTo(Math.max(0, y));
      window.history.replaceState(null, "", hash ? `#${hash}` : "/");
      return;
    }
    router.push(href);
  }, [pathname, router]);

  // The water pill renders plain anchors; a left click on one goes through the glide (or the router) instead of a jump.
  const onWaterClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a.nimbus-item");
    if (!a || MOD(e)) return;
    e.preventDefault();
    const i = items.findIndex((it) => it.href === a.getAttribute("href"));
    clicked.current = i;
    if (i >= 0) { activeRef.current = i; setActive(i); }
    navigate(a.getAttribute("href") ?? "/");
  };
  // Arrow keys move the drop (the Nimbus way); on the landing page the view follows it to the section. Routes wait for Enter.
  const onWaterChange = (i: number, item: LiquidNavItem) => {
    const fromClick = clicked.current === i;
    clicked.current = -1;
    activeRef.current = i;
    setActive(i);
    const href = (item as NavEntry).href;
    if (!fromClick && pathname === "/" && (href === "/" || href.startsWith("/#"))) navigate(href);
  };
  const pick = (href: string) => {
    setOpen(false);
    window.setTimeout(() => navigate(href), 160); // after the drawer's exit, so the glide is not fighting the scroll lock
  };

  // Waitlist on (1137): same button, same place, relabelled; it scrolls to the form on the landing page (joinHref).
  const ctaHref = waitlist ? joinHref(pathname) : "/signup";
  const ctaLabel = waitlist ? "Join waitlist" : "Get started";
  const current = Math.min(active, items.length - 1);

  return (
    <header
      ref={headerRef}
      className="lnav sticky top-0 z-50 pl-[max(0.75rem,var(--sa-l))] pr-[max(0.75rem,var(--sa-r))] pt-[calc(var(--sa-t)+0.75rem)] sm:pl-[max(1.5rem,var(--sa-l))] sm:pr-[max(1.5rem,var(--sa-r))]"
      data-split={split}
    >
      <div ref={rowRef} className="relative mx-auto grid max-w-[1180px] grid-cols-[1fr_auto_1fr] items-center gap-3 xl:max-w-[1240px]">
        <div ref={brandRef} className="lnav-pill col-start-1 flex items-center justify-self-start px-1.5">
          <Link href="/" data-mag="" className="flex h-11 shrink-0 items-center rounded-full px-2.5" aria-label="Outlly home">
            <OutlyLogo className="text-[17.4px]" compactBelow={360} />
          </Link>
        </div>

        {desktop && (
          <div ref={waterRef} className="lnav-water col-start-2 hidden lg:block" onClickCapture={onWaterClick}>
            <LiquidNavbar items={items} active={current} onChange={onWaterChange} tone={dark ? "dark" : "light"} />
          </div>
        )}

        <Dialog.Root open={open} onOpenChange={setOpen}>
          <div className="col-start-3 flex items-center gap-2 justify-self-end">
            <div ref={actionsRef} className="lnav-pill flex items-center px-1.5">
              <div ref={secRef} className="mr-1 hidden h-[52px] items-center gap-1 overflow-hidden whitespace-nowrap lg:flex">
                <ThemeToggle compact dense />
                {!signedIn && (
                  <AnimatedLink href="/login" className="inline-flex h-11 shrink-0 items-center rounded-full px-3.5 text-[14px] font-medium text-foreground/80 transition-colors hover:text-foreground">
                    Log in
                  </AnimatedLink>
                )}
              </div>
              {signedIn ? (
                <Link href="/home" data-mag="" className="lime-glow inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-lime px-4 text-[14px] font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 active:scale-95 sm:px-5">
                  <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                  <FlipText text="Dashboard" tone="inherit" />
                </Link>
              ) : (
                <Link href={ctaHref} data-mag="" className="lime-glow group inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-lime px-4 text-[14px] font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 active:scale-95 sm:px-5">
                  <FlipText text={ctaLabel} tone="inherit" />
                  <ArrowRight className="hidden h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 sm:block" aria-hidden="true" />
                </Link>
              )}
            </div>
            <Dialog.Trigger asChild>
              <button ref={menuRef} type="button" className="lnav-pill grid w-14 shrink-0 place-items-center text-foreground lg:hidden" aria-label={open ? "Close menu" : "Open menu"}>
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
                  {open ? <><line x1={5} y1={5} x2={15} y2={15} /><line x1={15} y1={5} x2={5} y2={15} /></> : <><line x1={3} y1={7} x2={17} y2={7} /><line x1={3} y1={13} x2={17} y2={13} /></>}
                </svg>
              </button>
            </Dialog.Trigger>
          </div>

          <Dialog.Portal>
            <Dialog.Overlay className="lnav-dim fixed inset-x-0 bottom-0 top-[calc(var(--sa-t)+4.75rem)] z-[60] lg:hidden" />
            <Dialog.Content
              className="lnav-sheet fixed left-[max(0.75rem,var(--sa-l))] right-[max(0.75rem,var(--sa-r))] top-[calc(var(--sa-t)+4.75rem)] z-[61] max-h-[calc(100dvh-var(--sa-t)-5.5rem)] overflow-y-auto rounded-[28px] p-2 outline-none lg:hidden"
              data-lenis-prevent=""
              aria-describedby={undefined}
            >
              <Dialog.Title className="sr-only">Menu</Dialog.Title>
              <nav aria-label="Sections" className="flex flex-col">
                {items.map((it, i) => (
                  <a
                    key={it.label}
                    href={it.href}
                    onClick={(e) => { if (MOD(e)) return; e.preventDefault(); pick(it.href); }}
                    aria-current={pathname === "/" && i === current ? "true" : undefined}
                    className={cn("flex h-12 items-center gap-3 rounded-2xl px-4 text-[17px] font-medium text-foreground/85 hover:bg-foreground/[0.05]", pathname === "/" && i === current && "bg-foreground/[0.06] text-foreground")}
                  >
                    <span className="text-foreground/70" aria-hidden="true">{it.icon}</span>
                    {it.label}
                    <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </a>
                ))}
                <a
                  href={PARTNERS.href}
                  onClick={(e) => { if (MOD(e)) return; e.preventDefault(); pick(PARTNERS.href); }}
                  aria-current={pathname === PARTNERS.href ? "page" : undefined}
                  className={cn("flex h-12 items-center gap-3 rounded-2xl px-4 text-[17px] font-medium text-foreground/85 hover:bg-foreground/[0.05]", pathname === PARTNERS.href && "bg-foreground/[0.06] text-foreground")}
                >
                  <span className="inline-block w-[18px]" aria-hidden="true" />
                  {PARTNERS.label}
                  <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </a>
              </nav>
              <div className="mx-2 my-2 h-px bg-border" aria-hidden="true" />
              <div className="flex items-center justify-between gap-3 px-2 pb-1">
                {signedIn ? (
                  <a href="/home" onClick={(e) => { if (MOD(e)) return; e.preventDefault(); pick("/home"); }} className="inline-flex h-11 items-center rounded-full px-3 text-[15px] font-semibold text-foreground/85 hover:bg-foreground/[0.05]">Dashboard</a>
                ) : (
                  <a href="/login" onClick={(e) => { if (MOD(e)) return; e.preventDefault(); pick("/login"); }} className="inline-flex h-11 items-center rounded-full px-3 text-[15px] font-semibold text-foreground/85 hover:bg-foreground/[0.05]">Log in</a>
                )}
                <ThemeToggle compact />
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </header>
  );
}
