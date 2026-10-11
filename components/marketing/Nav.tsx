"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, X } from "lucide-react";
import { OutlyMark } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { cn } from "@/lib/utils";

const LINKS = [
  { id: "how", label: "How it works" },
  { id: "features", label: "Features" },
  { id: "compare", label: "Compare" },
  { id: "pricing", label: "Pricing" },
];

/**
 * Marketing nav. Transparent over the hero, a frosted bar once you scroll. A single
 * indicator slides under the section you are reading (scrollspy via one
 * IntersectionObserver), and below lg the links live in a menu panel instead of
 * disappearing. Only transform/opacity animate.
 */
export function MarketingNav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (pathname !== "/") return;
    const els = LINKS.map((l) => document.getElementById(l.id)).filter(Boolean) as HTMLElement[];
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = LINKS.find((l) => seen.get(l.id));
        setActive(first?.id ?? null);
      },
      { rootMargin: "-35% 0px -55% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pathname]);

  useEffect(() => {
    const list = listRef.current;
    const a = active && list?.querySelector<HTMLElement>(`[data-id="${active}"]`);
    if (!list || !a) return setPill(null);
    setPill({ x: a.offsetLeft, w: a.offsetWidth });
  }, [active]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="mnav sticky top-0 z-50 px-3 pt-3 sm:px-6" data-scrolled={scrolled || open}>
      <div className="mnav-bar mx-auto flex h-14 max-w-[1180px] items-center gap-2 rounded-full pl-3 pr-1.5 sm:h-[60px] sm:pl-4">
        {/* One mark only: the SVG gradient is shared by id. */}
        <Link href="/" className="flex h-11 items-center gap-2 rounded-full pr-2 text-[17px]" aria-label="Outly home">
          <OutlyMark size={24} />
          <span className="font-display text-[1.2em] font-bold tracking-[-0.045em]">outly</span>
        </Link>

        <nav aria-label="Sections" className="relative mx-auto hidden lg:block">
          <div ref={listRef} className="relative flex items-center">
            <span
              aria-hidden="true"
              className="absolute top-1/2 h-9 -translate-y-1/2 rounded-full bg-foreground/[0.07] transition-[transform,width,opacity] duration-500 ease-[cubic-bezier(.22,1,.36,1)]"
              style={{ width: pill?.w ?? 0, transform: `translate3d(${pill?.x ?? 0}px,-50%,0)`, opacity: pill ? 1 : 0 }}
            />
            {LINKS.map((l) => (
              <Link
                key={l.id}
                data-id={l.id}
                href={`/#${l.id}`}
                aria-current={active === l.id ? "true" : undefined}
                className={cn(
                  "relative rounded-full px-4 py-2.5 text-[14.5px] font-medium transition-colors duration-200",
                  active === l.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </nav>

        <div className="ml-auto flex items-center gap-1.5 lg:ml-0">
          <ThemeToggle compact className="hidden sm:inline-flex" />
          <Link href="/login" className="hidden h-11 items-center rounded-full px-4 text-[14.5px] font-medium text-foreground/85 transition-colors hover:text-foreground sm:inline-flex">
            Log in
          </Link>
          <Link
            href="/signup"
            className="lime-glow group inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-lime px-4 text-[14px] font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 active:scale-95 sm:px-5"
          >
            Start creating
            <ArrowRight className="hidden h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 sm:block" aria-hidden="true" />
          </Link>
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
        id="mnav-panel"
        hidden={!open}
        className="glass hairline mx-auto mt-2 max-w-[1180px] overflow-hidden rounded-[28px] p-2 shadow-[0_24px_60px_-24px_rgba(0,0,0,.6)] lg:hidden"
      >
        <nav aria-label="Sections" className="flex flex-col">
          {LINKS.map((l) => (
            <Link
              key={l.id}
              href={`/#${l.id}`}
              onClick={() => setOpen(false)}
              className="flex h-12 items-center justify-between rounded-2xl px-4 font-display text-[19px] font-semibold tracking-tight hover:bg-foreground/[0.05]"
            >
              {l.label}
              <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </Link>
          ))}
          <Link href="/login" onClick={() => setOpen(false)} className="mt-1 flex h-12 items-center rounded-2xl px-4 text-[16px] font-medium text-muted-foreground hover:bg-foreground/[0.05] sm:hidden">
            Log in
          </Link>
          <div className="mt-1 flex items-center justify-between rounded-2xl px-4 py-2 sm:hidden">
            <span className="text-[15px] text-muted-foreground">Theme</span>
            <ThemeToggle compact />
          </div>
        </nav>
      </div>
    </header>
  );
}
