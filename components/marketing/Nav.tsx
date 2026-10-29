"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatedLink } from "@/components/ui/animated-link";
import { useSignedIn } from "./useSignedIn";
import { useWaitlist } from "./useWaitlist";
import { useHiddenSections } from "./useHiddenSections";
import { BounceText } from "./Split";
import { usePathname } from "next/navigation";
import { ArrowRight, ChevronDown, LayoutDashboard, Menu, X } from "lucide-react";
import { PRODUCT_ITEMS, ProductPanel, ProductTilesCompact } from "./NavProduct";
import { OutlyLogo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { LiveCount } from "@/components/shared/LiveCount";
import { cn } from "@/lib/utils";

const LINKS = [
  { id: "how", label: "How it works" },
  { id: "features", label: "Product" }, // opens the Product mega menu on lg+
  { id: "compare", label: "Compare" }, // lives inside Product; kept here for the scrollspy
  { id: "pricing", label: "Pricing" },
  { id: "faq", label: "FAQ" },
];

/**
 * Marketing nav: a floating pill on a near-solid card surface, so text holds 4.5:1 over
 * the hero and the dark sections alike. Scrollspy: the active link is the last section
 * whose top has crossed 40% of the viewport; clicking a link marks it at once. Below lg the
 * links live in a card that drops under the pill and closes on outside tap, Esc, link tap
 * or route change.
 */
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
  const lockUntil = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const menuWrap = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hoverT = useRef<number>(0);
  const hoverAt = useRef(0); // a click right after hover opened the menu should not close it again
  const products = PRODUCT_ITEMS.filter((p) => !p.sec || !hidden.has(p.sec));
  const [pill, setPill] = useState<{ l: number; r: number; dir: "left" | "right" | "none" } | null>(null);

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
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
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

  const ctaHref = waitlist ? "/waitlist" : "/signup";
  const ctaLabel = waitlist ? "Join the waitlist" : "Start creating";

  return (
    <header className="mnav sticky top-0 z-50 px-3 pt-3 sm:px-6" data-scrolled={scrolled || open}>
      <div ref={barRef} className="mnav-bar mx-auto flex h-14 max-w-[1180px] items-center gap-2 rounded-full pl-3 pr-1.5 sm:h-[60px] sm:pl-4 sm:pr-2">
        <Link href="/" className="flex h-11 items-center gap-2 rounded-full pr-2" aria-label="Outlly home">
          <OutlyLogo className="text-[17.4px]" />
        </Link>

        <nav aria-label="Sections" className="mx-auto hidden lg:block">
          <div ref={listRef} className="relative">
          <span
            aria-hidden="true"
            className="mnav-pill"
            data-dir={pill?.dir ?? "none"}
            style={{ left: pill?.l ?? 0, right: pill?.r ?? 0, opacity: pill ? 1 : 0 }}
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
                    {l.label}
                    <ChevronDown className="np-chev h-3.5 w-3.5" aria-hidden="true" />
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
                  {l.label}
                </Link>
              </li>
              ),
            )}
          </ul>
          </div>
        </nav>

        <div
          ref={menuWrap}
          id="mnav-product"
          hidden={!menu}
          onPointerEnter={hoverOpen}
          onPointerLeave={hoverClose}
          className="np-panel hidden lg:block"
        >
          <p className="sr-only">Product</p>
          <ProductPanel items={products} onPick={pickProduct} showDemo={!hidden.has("demo")} />
        </div>

        <div className="ml-auto flex items-center gap-1.5 lg:ml-0">
          {/* 1040: live creator count lives in the bar (moved from the hero); full words where there is room. */}
          <LiveCount className="mnav-live hidden flex-nowrap whitespace-nowrap px-2 md:inline-flex lg:hidden xl:inline-flex" />
          <ThemeToggle compact className="hidden sm:inline-flex" />
          {signedIn ? (
            <Link
              href="/home"
              className="lime-glow inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-lime px-4 text-[14px] font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 active:scale-95 sm:px-5"
            >
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
              Dashboard
            </Link>
          ) : (
            <>
              <AnimatedLink href="/login" className="hidden h-11 rounded-full px-4 text-[14.5px] font-semibold text-foreground/80 transition-colors hover:text-foreground sm:inline-flex">
                Log in
              </AnimatedLink>
              <Link
                href={ctaHref}
                data-bounce=""
                className="lime-glow group inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-lime px-4 text-[14px] font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 active:scale-95 sm:px-5"
              >
                <BounceText text={ctaLabel} />
                <ArrowRight className="hidden h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 sm:block" aria-hidden="true" />
              </Link>
            </>
          )}
          <button
            type="button"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground transition-colors hover:bg-foreground/[0.06] lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mnav-panel"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      <div ref={panelRef} id="mnav-panel" hidden={!open} className="mnav-panel mx-auto mt-2 max-w-[1180px] overflow-hidden rounded-[28px] p-2 lg:hidden">
        <nav aria-label="Sections" className="flex flex-col">
          <p className="px-4 pb-1 pt-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Product</p>
          <ProductTilesCompact items={products} onPick={pickProduct} />
          <div className="mx-4 my-2 h-px bg-border" aria-hidden="true" />
          {links.filter((l) => l.id !== "features").map((l) => (
            <Link
              key={l.id}
              data-sec={l.id}
              href={`/#${l.id}`}
              onClick={() => pick(l.id)}
              aria-current={active === l.id ? "true" : undefined}
              className={cn(
                "flex h-12 items-center justify-between rounded-2xl px-4 font-display text-[19px] font-semibold tracking-tight hover:bg-foreground/[0.05]",
                active === l.id && "bg-foreground/[0.06]",
              )}
            >
              {l.label}
              <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </Link>
          ))}
          {!signedIn && (
            <Link href="/login" onClick={() => setOpen(false)} className="mt-1 flex h-12 items-center rounded-2xl px-4 text-[16px] font-semibold text-foreground/80 hover:bg-foreground/[0.05] sm:hidden">
              Log in
            </Link>
          )}
          <div className="mt-1 flex items-center justify-between rounded-2xl px-4 py-2 sm:hidden">
            <span className="text-[15px] text-muted-foreground">Theme</span>
            <ThemeToggle compact />
          </div>
        </nav>
      </div>
    </header>
  );
}
