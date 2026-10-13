"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSignedIn } from "./useSignedIn";
import { useWaitlist } from "./useWaitlist";
import { useHiddenSections } from "./useHiddenSections";
import { usePathname } from "next/navigation";
import { ArrowRight, LayoutDashboard, Menu, X } from "lucide-react";
import { OutlyLogo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { cn } from "@/lib/utils";

const LINKS = [
  { id: "how", label: "How it works" },
  { id: "features", label: "Features" },
  { id: "compare", label: "Compare" },
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
  const links = LINKS.filter((l) => !hidden.has(l.id));
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lockUntil = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ l: number; r: number; dir: "left" | "right" | "none" } | null>(null);

  // Liquid indicator: one pill under the active link. The edge in the direction of travel
  // leads and the trailing edge catches up, so it stretches across and settles.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = (fromResize = false) => {
      const a = active ? list.querySelector<HTMLElement>(`[data-id="${active}"]`) : null;
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

  useEffect(() => setOpen(false), [pathname]);

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
  };

  const ctaHref = waitlist ? "/waitlist" : "/signup";
  const ctaLabel = waitlist ? "Join the waitlist" : "Start creating";

  return (
    <header className="mnav sticky top-0 z-50 px-3 pt-3 sm:px-6" data-scrolled={scrolled || open}>
      <div ref={barRef} className="mnav-bar mx-auto flex h-14 max-w-[1180px] items-center gap-2 rounded-full pl-3 pr-1.5 sm:h-[60px] sm:pl-4">
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
            {links.map((l) => (
              <li key={l.id}>
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
            ))}
          </ul>
          </div>
        </nav>

        <div className="ml-auto flex items-center gap-1.5 lg:ml-0">
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
              <Link href="/login" className="hidden h-11 items-center rounded-full px-4 text-[14.5px] font-semibold text-foreground/80 transition-colors hover:text-foreground sm:inline-flex">
                Log in
              </Link>
              <Link
                href={ctaHref}
                className="lime-glow group inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-lime px-4 text-[14px] font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 active:scale-95 sm:px-5"
              >
                {ctaLabel}
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
          {links.map((l) => (
            <Link
              key={l.id}
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
