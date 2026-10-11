"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, LayoutDashboard, Menu, X } from "lucide-react";
import { OutlyMark } from "@/components/brand/Logo";
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
 * Marketing nav. Always sits on a solid, high-contrast surface so it reads over the
 * colourful hero and the dark CTA alike. Scrollspy: the active link is the last section
 * whose top has crossed 40% of the viewport, so it never goes blank between sections and
 * clears above the first one. Clicking a link marks it at once instead of waiting for the
 * scroll to land. Below lg the links live in a panel that closes on outside tap, Esc,
 * link tap or route change.
 */
export function MarketingNav({ signedIn = false }: { signedIn?: boolean }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lockUntil = useRef(0);

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
    const list = listRef.current;
    const a = active && list?.querySelector<HTMLElement>(`[data-id="${active}"]`);
    if (!list || !a) return setPill(null);
    setPill({ x: a.offsetLeft, w: a.offsetWidth });
  }, [active]);

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

  return (
    <header className="mnav sticky top-0 z-50 px-3 pt-3 sm:px-6" data-scrolled={scrolled || open}>
      {/* Tap-outside scrim for the mobile panel. Pointer-events only while open. */}
      <div
        aria-hidden="true"
        className={cn("fixed inset-0 -z-10 bg-black/25 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden", open ? "opacity-100" : "pointer-events-none opacity-0")}
      />
      <div ref={barRef} className="mnav-bar mx-auto flex h-14 max-w-[1180px] items-center gap-2 rounded-full pl-3 pr-1.5 sm:h-[60px] sm:pl-4">
        <Link href="/" className="flex h-11 items-center gap-2 rounded-full pr-2 text-[17px]" aria-label="Outly home">
          <OutlyMark size={24} />
          <span className="font-display text-[1.2em] font-bold tracking-[-0.03em]">outly</span>
        </Link>

        <nav aria-label="Sections" className="relative mx-auto hidden lg:block">
          <div ref={listRef} className="relative flex items-center">
            <span
              aria-hidden="true"
              className="absolute top-1/2 h-9 -translate-y-1/2 rounded-full bg-foreground shadow-[0_6px_16px_-8px_rgba(0,0,0,.5)] transition-[transform,width,opacity] duration-500 ease-[cubic-bezier(.22,1,.36,1)]"
              style={{ width: pill?.w ?? 0, transform: `translate3d(${pill?.x ?? 0}px,-50%,0)`, opacity: pill ? 1 : 0 }}
            />
            {LINKS.map((l) => (
              <Link
                key={l.id}
                data-id={l.id}
                href={`/#${l.id}`}
                onClick={() => pick(l.id)}
                aria-current={active === l.id ? "true" : undefined}
                className={cn(
                  "relative rounded-full px-4 py-2.5 text-[14.5px] font-semibold transition-colors duration-300",
                  active === l.id ? "text-background" : "text-foreground/80 hover:text-foreground",
                )}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </nav>

        <div className="ml-auto flex items-center gap-1.5 lg:ml-0">
          <ThemeToggle compact className="hidden sm:inline-flex" />
          {signedIn ? (
            <Link
              href="/home"
              className="lime-glow group inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-lime px-4 text-[14px] font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 active:scale-95 sm:px-5"
            >
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
              Dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className="hidden h-11 items-center rounded-full px-4 text-[14.5px] font-semibold text-foreground/85 transition-colors hover:text-foreground sm:inline-flex">
                Log in
              </Link>
              <Link
                href="/signup"
                className="lime-glow group inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-lime px-4 text-[14px] font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 active:scale-95 sm:px-5"
              >
                Start creating
                <ArrowRight className="hidden h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 sm:block" aria-hidden="true" />
              </Link>
            </>
          )}
          <button
            type="button"
            className="grid h-11 w-11 place-items-center rounded-full text-foreground transition-colors hover:bg-foreground/[0.06] lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mnav-panel"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      <div
        ref={panelRef}
        id="mnav-panel"
        hidden={!open}
        className="mnav-panel mx-auto mt-2 max-w-[1180px] overflow-hidden rounded-[28px] p-2 lg:hidden"
      >
        <nav aria-label="Sections" className="flex flex-col">
          {LINKS.map((l) => (
            <Link
              key={l.id}
              href={`/#${l.id}`}
              onClick={() => pick(l.id)}
              aria-current={active === l.id ? "true" : undefined}
              className={cn(
                "flex h-12 items-center justify-between rounded-2xl px-4 font-display text-[19px] font-semibold tracking-tight transition-colors",
                active === l.id ? "bg-foreground text-background" : "hover:bg-foreground/[0.06]",
              )}
            >
              {l.label}
              <ArrowRight className={cn("h-4 w-4", active === l.id ? "text-background/70" : "text-muted-foreground")} aria-hidden="true" />
            </Link>
          ))}
          {!signedIn && (
            <Link href="/login" onClick={() => setOpen(false)} className="mt-1 flex h-12 items-center rounded-2xl px-4 text-[16px] font-semibold text-foreground/80 hover:bg-foreground/[0.06] sm:hidden">
              Log in
            </Link>
          )}
          <div className="mt-1 flex items-center justify-between rounded-2xl px-4 py-2 sm:hidden">
            <span className="text-[15px] text-foreground/75">Theme</span>
            <ThemeToggle compact />
          </div>
        </nav>
      </div>
    </header>
  );
}
