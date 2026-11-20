"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatedLink } from "@/components/ui/animated-link";
import { useSignedIn } from "./useSignedIn";
import { joinHref, useWaitlist } from "./useWaitlist";
import { useHiddenSections } from "./useHiddenSections";
import { FlipText } from "@/components/ui/text-fx";
import { usePathname } from "next/navigation";
import { ArrowRight, ChevronDown, LayoutDashboard } from "lucide-react";
import { PRODUCT_ITEMS, ProductPanel, ProductTilesCompact } from "./NavProduct";
import { OutlyLogo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { LiveCount } from "@/components/shared/LiveCount";
import { cn } from "@/lib/utils";
import { loadGsap } from "@/lib/motion/gsap-lazy";
import { BURGER, CROSS, islandMenu, stackMenu, type MenuMotion } from "@/lib/motion/navMotion";

const LINKS = [
  { id: "how", label: "How it works" },
  { id: "features", label: "Product" }, // opens the Product mega menu on lg+
  { id: "compare", label: "Compare" }, // lives inside Product; kept here for the scrollspy
  { id: "pricing", label: "Pricing" },
  { id: "faq", label: "FAQ" },
];
// R1282: a route, not a landing section, so it sits outside LINKS and the scrollspy.
const PARTNERS = { href: "/partners", label: "Partner With Us", short: "Partners" };

/**
 * Marketing nav: a floating pill on a near-solid card surface, so text holds 4.5:1 over
 * the hero and the dark sections alike. Scrollspy: the active link is the last section
 * whose top has crossed 40% of the viewport; clicking a link marks it at once. Below lg the
 * links live in a card that drops under the pill and closes on outside tap, Esc, link tap
 * or route change.
 *
 * 1117: one row at every desktop width, in this order: logo, the four links, the live count, theme, CTA. Gaps and link
 * padding scale with the viewport (globals.css), and when the row gets tight the live count gives way first: the
 * creators half goes, then the whole count (data-fit on the bar), so the links never crowd. Below lg the phone menu
 * takes over.
 *
 * 1181: both menus animate with GSAP demos the user picked (lib/motion/navMotion.ts). The Product menu is the
 * "orchestrated easeReverse" island: it springs open from the trigger and settles shut on its own reverse eases. The
 * phone menu is the "interruptible single timeline": three stacked cards slide in and, on close, fall away at random
 * tilts. Each menu stays mounted until its exit has played; reduced motion opens and closes them at once.
 */
const FIT_STEPS = ["full", "online", "none"] as const;
const MIN_ROOM = 20; // px kept clear on each side of the links before the live count steps down
export function MarketingNav() {
  const signedIn = useSignedIn();
  const waitlist = useWaitlist();
  const pathname = usePathname();
  const hidden = useHiddenSections(pathname);
  const links = LINKS.filter((l) => !hidden.has(l.id) && l.id !== "compare");
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const lockUntil = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const menuWrap = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hoverT = useRef<number>(0);
  const hoverAt = useRef(0); // a click right after hover opened the menu should not close it again
  const products = PRODUCT_ITEMS.filter((p) => !p.sec || !hidden.has(p.sec));
  const [pill, setPill] = useState<{ l: number; r: number; dir: "left" | "right" | "none" } | null>(null);
  const logoRef = useRef<HTMLAnchorElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const clusterRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const chevRef = useRef<SVGSVGElement>(null);
  const barTop = useRef<SVGLineElement>(null);
  const barBot = useRef<SVGLineElement>(null);
  const [npShown, setNpShown] = useState(false); // the Product panel stays mounted while its reverse plays
  const [sheetShown, setSheetShown] = useState(false); // same for the phone menu's exit
  const [animated, setAnimated] = useState(false); // GSAP drives the menu icon; until then (or with reduced motion) it swaps at once
  const npMotion = useRef<MenuMotion | null>(null);
  const sheetMotion = useRef<MenuMotion | null>(null);
  const menuNow = useRef(false);
  const openNow = useRef(false);

  // Fit (1117): try the full live count, then the "online" half, then none, and keep the first that leaves the links
  // MIN_ROOM clear on both sides. Re-checked when the bar resizes (the viewport) and when the right-hand group's
  // content changes (the count arriving, a sign-in); writing data-fit on the bar changes neither, so it can't loop.
  useLayoutEffect(() => {
    const bar = barRef.current;
    const cluster = clusterRef.current;
    if (!bar || !cluster) return;
    const fits = () => {
      if (bar.scrollWidth > bar.clientWidth + 1) return false;
      const logo = logoRef.current?.getBoundingClientRect();
      const right = cluster.getBoundingClientRect().left;
      const nav = navRef.current;
      if (!logo) return true;
      if (!nav || !nav.offsetParent) return right - logo.right >= MIN_ROOM;
      const n = nav.getBoundingClientRect();
      return Math.min(n.left - logo.right, right - n.right) >= MIN_ROOM;
    };
    const fit = () => {
      for (const step of FIT_STEPS) {
        bar.dataset.fit = step;
        if (step === "none" || fits()) break;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(bar);
    const mo = new MutationObserver(fit);
    mo.observe(cluster, { childList: true, subtree: true, characterData: true });
    void document.fonts?.ready.then(fit);
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  // Liquid indicator: one pill under the active link. The edge in the direction of travel
  // leads and the trailing edge catches up, so it stretches across and settles.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = (fromResize = false) => {
      const id = active === "compare" ? "features" : active; // Compare sits inside the Product menu
      const a = id ? list.querySelector<HTMLElement>(`[data-id="${id}"]`) : null;
      if (!a) return setPill(null);
      const l = a.offsetLeft;
      const r = list.clientWidth - (a.offsetLeft + a.offsetWidth);
      setPill((prev) => {
        if (prev && prev.l === l && prev.r === r) return prev; // ResizeObserver fires on observe; keep the running slide
        return { l, r, dir: !prev || fromResize ? "none" : l > prev.l ? "right" : l < prev.l ? "left" : prev.dir };
      });
    };
    measure();
    const ro = new ResizeObserver(() => measure(true));
    ro.observe(list);
    return () => ro.disconnect();
  }, [active]);

  useEffect(() => {
    let raf = 0;
    const spy = () => {
      raf = 0;
      setScrolled(window.scrollY > 12);
      if (pathname !== "/" || Date.now() < lockUntil.current) return;
      const line = window.innerHeight * 0.4;
      let current: string | null = null;
      for (const l of LINKS) {
        const el = document.getElementById(l.id);
        if (el && el.getBoundingClientRect().top <= line) current = l.id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(spy);
    };
    spy();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [pathname]);

  useEffect(() => {
    setOpen(false);
    setMenu(false);
  }, [pathname]);

  // 1181: the menus' GSAP timelines, built once GSAP is in (loaded lazily) and rebuilt when what the menus hold changes.
  const shape = `${signedIn}|${waitlist}|${products.length}|${links.length}|${hidden.has("demo")}`;
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let dead = false;
    const made: MenuMotion[] = [];
    void loadGsap()
      .then((gsap) => {
        if (dead) return;
        const panel = menuWrap.current;
        if (panel) {
          npMotion.current = islandMenu(gsap, {
            panel,
            chev: chevRef.current,
            items: Array.from(panel.querySelectorAll(".np-tile, .np-feature")),
            onHidden: () => setNpShown(false),
          });
          made.push(npMotion.current);
        }
        const sheet = panelRef.current;
        const bg = sheet?.querySelector<HTMLElement>(".mnav-sheet-bg");
        const cards = sheet ? Array.from(sheet.querySelectorAll<HTMLElement>(".mnav-card")) : [];
        if (sheet && bg && cards.length) {
          sheetMotion.current = stackMenu(gsap, {
            bg,
            cards,
            items: Array.from(sheet.querySelectorAll(".mnav-card-top .np-tile, .mnav-card-top [data-mi]")),
            foot: sheet.querySelector(".mnav-foot"),
            bars: barTop.current && barBot.current ? [barTop.current, barBot.current] : null,
            onHidden: () => setSheetShown(false),
          });
          made.push(sheetMotion.current);
          setAnimated(true);
        }
        headerRef.current?.setAttribute("data-gsap", "");
        // A menu opened before GSAP landed plays in now.
        if (menuNow.current) npMotion.current?.open();
        if (openNow.current) sheetMotion.current?.open();
      })
      .catch(() => {});
    return () => {
      dead = true;
      made.forEach((m) => m.kill());
      npMotion.current = null;
      sheetMotion.current = null;
      setAnimated(false);
      headerRef.current?.removeAttribute("data-gsap");
    };
  }, [shape]);

  // Open: mount, then play the entrance. Close: play the exit; the menu unmounts when it has finished (onHidden).
  useEffect(() => {
    menuNow.current = menu;
    const m = npMotion.current;
    if (menu) {
      setNpShown(true);
      m?.open();
    } else if (m) m.close();
    else setNpShown(false);
  }, [menu]);
  useEffect(() => {
    openNow.current = open;
    const m = sheetMotion.current;
    if (open) {
      setSheetShown(true);
      m?.open();
    } else if (m) m.close();
    else setSheetShown(false);
  }, [open]);

  // The phone menu covers the screen: the page behind it goes inert and stops scrolling while it is open.
  useEffect(() => {
    if (!open) return;
    const page = Array.from(document.querySelectorAll<HTMLElement>("#main, #main ~ footer"));
    page.forEach((el) => el.setAttribute("inert", ""));
    document.documentElement.classList.add("mnav-lock");
    return () => {
      page.forEach((el) => el.removeAttribute("inert"));
      document.documentElement.classList.remove("mnav-lock");
    };
  }, [open]);

  // Product menu: hover opens it for a mouse (with a short grace period so the pointer can travel
  // from the trigger down into the panel), click / Enter / Space toggles it for everyone else.
  // Esc closes and returns focus to the trigger; focus or a tap leaving the menu closes it.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenu(false);
      triggerRef.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuWrap.current?.contains(t) && !triggerRef.current?.contains(t)) setMenu(false);
    };
    const onFocus = (e: FocusEvent) => {
      const t = e.target;
      if (t instanceof Node && !menuWrap.current?.contains(t) && !triggerRef.current?.contains(t)) setMenu(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("focusin", onFocus);
    };
  }, [menu]);
  const hoverOpen = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(hoverT.current);
    if (!menu) hoverAt.current = Date.now();
    setMenu(true);
  };
  const hoverClose = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(hoverT.current);
    hoverT.current = window.setTimeout(() => setMenu(false), 180);
  };
  useEffect(() => () => clearTimeout(hoverT.current), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 1144: Escape from inside the panel hands focus back to the menu button, not to the page top.
      const inside = panelRef.current?.contains(document.activeElement);
      setOpen(false);
      if (inside) menuBtn.current?.focus();
    };
    // pointerdown, not click: closes before the tap lands on whatever is underneath.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!barRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const pick = (id: string) => {
    setActive(id);
    lockUntil.current = Date.now() + 1200; // let the smooth scroll land before the spy takes over again
    setOpen(false);
    setMenu(false);
  };
  const pickProduct = (sec: string | null) => {
    if (sec) pick(sec === "how" || sec === "compare" ? sec : "features");
    else {
      setOpen(false);
      setMenu(false);
    }
  };

  // Waitlist on (1137): same button, same place, relabelled; it scrolls to the form on the landing page (joinHref).
  const ctaHref = waitlist ? joinHref(pathname) : "/signup";
  const ctaLabel = waitlist ? "Join Waitlist" : "Start creating";

  return (
    <header ref={headerRef} className="mnav sticky top-0 z-50 pl-[max(0.75rem,var(--sa-l))] pr-[max(0.75rem,var(--sa-r))] pt-[calc(var(--sa-t)+0.75rem)] sm:pl-[max(1.5rem,var(--sa-l))] sm:pr-[max(1.5rem,var(--sa-r))]" data-scrolled={scrolled || open}>
      <div ref={barRef} data-lens="" data-lg-shine="" className="mnav-bar mx-auto flex h-14 max-w-[1180px] items-center gap-2 rounded-full pl-3 pr-1.5 sm:h-[60px] sm:pl-4 sm:pr-2">
        <span className="lg-shine" aria-hidden="true" />
        <Link ref={logoRef} href="/" data-mag="" className="flex h-11 shrink-0 items-center gap-2 rounded-full pr-1" aria-label="Outlly home">
          <OutlyLogo className="text-[17.4px]" />
        </Link>

        <nav ref={navRef} aria-label="Sections" className="mx-auto hidden shrink-0 lg:block">
          <div ref={listRef} className="relative">
          <span
            aria-hidden="true"
            className="mnav-pill"
            data-dir={pill?.dir ?? "none"}
            style={{ ["--l" as string]: `${pill?.l ?? 0}px`, ["--r" as string]: `${pill?.r ?? 0}px`, opacity: pill ? 1 : 0 }}
          />
          <ul className="flex items-center">
            {links.map((l) =>
              l.id === "features" ? (
                <li key={l.id} data-sec={l.id} onPointerEnter={hoverOpen} onPointerLeave={hoverClose}>
                  <button
                    ref={triggerRef}
                    type="button"
                    data-id={l.id}
                    aria-expanded={menu}
                    aria-controls="mnav-product"
                    onClick={() => setMenu((v) => (Date.now() - hoverAt.current < 600 ? true : !v))}
                    onKeyDown={(e) => {
                      // Tab from the open trigger goes into the panel (it sits later in the DOM).
                      if (e.key === "Tab" && !e.shiftKey && menu) {
                        e.preventDefault();
                        document.querySelector<HTMLElement>("#mnav-product .np-tile")?.focus();
                        return;
                      }
                      if (e.key !== "ArrowDown") return;
                      e.preventDefault();
                      setMenu(true);
                      requestAnimationFrame(() => document.querySelector<HTMLElement>("#mnav-product .np-tile")?.focus());
                    }}
                    className={cn("mnav-link gap-1", (active === l.id || active === "compare") && "is-active", menu && "is-open")}
                  >
                    <FlipText text={l.label} />
                    <ChevronDown ref={chevRef} className="np-chev h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ) : (
              <li key={l.id} data-sec={l.id}>
                <Link
                  data-id={l.id}
                  href={`/#${l.id}`}
                  onClick={() => pick(l.id)}
                  aria-current={active === l.id ? "true" : undefined}
                  className={cn("mnav-link", active === l.id && "is-active")}
                >
                  <FlipText text={l.label} />
                </Link>
              </li>
              ),
            )}
            <li>
              <Link
                href={PARTNERS.href}
                aria-current={pathname === PARTNERS.href ? "page" : undefined}
                className={cn("mnav-link", pathname === PARTNERS.href && "!text-foreground")}
              >
                {/* The full label only fits the one-row bar from xl; at lg it shortens so the row never wraps. */}
                <span className="xl:hidden"><FlipText text={PARTNERS.short} /></span>
                <span className="hidden xl:inline"><FlipText text={PARTNERS.label} /></span>
              </Link>
            </li>
          </ul>
          </div>
        </nav>

        <div
          ref={menuWrap}
          id="mnav-product"
          hidden={!npShown}
          onPointerEnter={hoverOpen}
          onPointerLeave={hoverClose}
          className="np-panel hidden lg:block"
        >
          <p className="sr-only">Product</p>
          <ProductPanel items={products} onPick={pickProduct} showDemo={!hidden.has("demo")} />
        </div>

        <div ref={clusterRef} className="mnav-end ml-auto flex shrink-0 items-center gap-1.5 lg:ml-0">
          {/* 1040: live creator count lives in the bar (moved from the hero). 1117: one short line, steps down via data-fit. */}
          <LiveCount nav className="mnav-live hidden px-1.5 md:inline-flex" />
          <ThemeToggle compact dense className="hidden sm:inline-flex" />
          <span aria-hidden="true" className="mnav-sep mx-1 hidden sm:block" />
          {signedIn ? (
            <Link
              href="/home"
              data-mag=""
              className="lime-glow inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-lime px-4 text-[14px] font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 active:scale-95 sm:px-5 lg:px-4 xl:px-5"
            >
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
              <FlipText text="Dashboard" tone="inherit" />
            </Link>
          ) : (
            <>
              <AnimatedLink href="/login" className="hidden h-11 shrink-0 rounded-full px-3.5 text-[14px] font-medium text-foreground/80 transition-colors hover:text-foreground sm:inline-flex lg:px-3 xl:px-3.5">
                Sign in
              </AnimatedLink>
              <Link
                href={ctaHref}
                data-mag=""
                className="lime-glow group inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-lime px-4 text-[14px] font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 active:scale-95 sm:px-5 lg:px-4 xl:px-5"
              >
                <FlipText text={ctaLabel} tone="inherit" />
                <ArrowRight className="hidden h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 sm:block" aria-hidden="true" />
              </Link>
            </>
          )}
          <button
            ref={menuBtn}
            type="button"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground transition-colors hover:bg-foreground/[0.06] lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mnav-panel"
            onClick={() => setOpen((v) => !v)}
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
              <line ref={barTop} {...(!animated && open ? CROSS[0] : BURGER[0])} />
              <line ref={barBot} {...(!animated && open ? CROSS[1] : BURGER[1])} />
            </svg>
          </button>
        </div>
      </div>

      {/* 1181: the phone menu, three stacked cards over a dimmed page (GSAP demo "interruptible single timeline"). It sits
          under the bar (z -1 inside the header), so the bar and its morphing menu button stay on top. */}
      <div ref={panelRef} id="mnav-panel" hidden={!sheetShown} data-open={open} data-lenis-prevent="" className="mnav-sheet">
        <div className="mnav-sheet-bg" aria-hidden="true" onClick={() => setOpen(false)} />
        <div className="mnav-card mnav-card-top">
          <nav aria-label="Sections" className="flex flex-col">
            <p data-mi="" className="px-4 pb-1 pt-2 text-xs font-semibold text-muted-foreground">Product</p>
            <ProductTilesCompact items={products} onPick={pickProduct} />
            <div className="mx-4 my-2 h-px bg-border" aria-hidden="true" />
            {links.filter((l) => l.id !== "features").map((l) => (
              <Link
                key={l.id}
                data-mi=""
                data-sec={l.id}
                href={`/#${l.id}`}
                onClick={() => pick(l.id)}
                aria-current={active === l.id ? "true" : undefined}
                className={cn(
                  "flex h-12 items-center justify-between rounded-2xl px-4 font-display text-[22px] font-semibold tracking-tight hover:bg-foreground/[0.05]",
                  active === l.id && "bg-foreground/[0.06]",
                )}
              >
                {l.label}
                <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </Link>
            ))}
            <Link
              data-mi=""
              href={PARTNERS.href}
              onClick={() => setOpen(false)}
              aria-current={pathname === PARTNERS.href ? "page" : undefined}
              className={cn(
                "flex h-12 items-center justify-between rounded-2xl px-4 font-display text-[22px] font-semibold tracking-tight hover:bg-foreground/[0.05]",
                pathname === PARTNERS.href && "bg-foreground/[0.06]",
              )}
            >
              {PARTNERS.label}
              <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </Link>
          </nav>
          {!signedIn && (
            <div className="mnav-foot">
              <Link href="/login" onClick={() => setOpen(false)} className="flex h-12 items-center rounded-2xl px-4 text-[16px] font-semibold text-foreground/80 hover:bg-foreground/[0.05]">
                Sign in
              </Link>
            </div>
          )}
        </div>
        <div className="mnav-card mnav-card-mid">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] opacity-75">One upload, three destinations</p>
          <p className="mt-1.5 font-display text-[21px] font-semibold leading-tight tracking-tight">
            {hidden.has("demo") ? "Post once, everywhere" : "See it in 60 seconds"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {!hidden.has("demo") && (
              <Link href="/#demo" onClick={() => pickProduct("demo")} className="mnav-chip mnav-chip-ink">
                Watch the demo
              </Link>
            )}
            <Link href={signedIn ? "/home" : ctaHref} onClick={() => setOpen(false)} className="mnav-chip">
              {signedIn ? "Dashboard" : ctaLabel}
            </Link>
          </div>
        </div>
        <div className="dark mnav-card mnav-card-end">
          <span className="text-[15px] text-muted-foreground">Theme</span>
          <ThemeToggle compact />
        </div>
      </div>
    </header>
  );
}
