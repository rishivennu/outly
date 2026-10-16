"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { AnimatedLink } from "@/components/ui/animated-link";
import { useSignedIn } from "./useSignedIn";
import { useWaitlist } from "./useWaitlist";
import { useHiddenSections } from "./useHiddenSections";
import { usePathname } from "next/navigation";
import { CookieSettingsButton } from "@/components/shared/CookieConsent";
import { ArrowRight, ArrowUp, LayoutDashboard } from "lucide-react";
import { OutlyLogo } from "@/components/brand/Logo";
import { PlatformGlyph } from "@/components/shared/PlatformIcon";
import { BounceText } from "./Split";
import { FooterWordmark } from "./FooterWordmark";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/#how", label: "How it works" },
      { href: "/#features", label: "Features" },
      { href: "/#platforms", label: "Platforms" },
      { href: "/#compare", label: "Compare" },
      { href: "/#pricing", label: "Pricing" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/help", label: "Help centre" },
      { href: "/contact", label: "Contact" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
];

const PLATFORMS = [
  { id: "instagram", label: "Instagram Reels" },
  { id: "youtube", label: "YouTube Shorts" },
  { id: "x", label: "X posts" },
] as const;

/**
 * Footer as one rounded card: a short pitch with the right next step (Dashboard when signed
 * in), two link columns, the three destinations, and the wordmark set huge as a sign-off.
 * Every item is a real link; nothing points at "#".
 */
export function MarketingFooter() {
  // The wordmark's signature loop only runs while it is on screen (no repaint work when scrolled away).
  const wordRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wordRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => (el.dataset.play = e.isIntersecting ? "1" : "0"), { rootMargin: "80px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const signedIn = useSignedIn();
  const hidden = useHiddenSections(usePathname());
  const waitlist = useWaitlist();
  return (
    <footer className="px-3 pb-3 pt-6 sm:px-6 sm:pb-6">
      <div className="footer-card relative mx-auto max-w-[1240px] overflow-clip rounded-[32px] sm:rounded-[40px]">
        <div className="relative grid gap-10 px-6 pb-8 pt-10 sm:px-10 sm:pt-14 md:grid-cols-[1.5fr_1fr_1fr] md:gap-8">
          <div>
            <OutlyLogo size={28} className="text-[20px]" />
            <p className="ft-body mt-4 max-w-sm text-[15.5px] leading-relaxed text-foreground/75">
              Upload once. Publish to Reels, Shorts and X. See exactly what happened to each one.
            </p>
            <Link
              href={signedIn ? "/home" : waitlist ? "/waitlist" : "/signup"}
              data-bounce=""
              className="lime-glow group mt-6 inline-flex h-12 items-center gap-2 rounded-full bg-lime px-5 text-[15px] font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 hover:-translate-y-px active:scale-95"
            >
              {signedIn ? (
                <>
                  <LayoutDashboard className="h-4 w-4" aria-hidden="true" /> <BounceText text="Open your dashboard" />
                </>
              ) : (
                <>
                  <BounceText text={waitlist ? "Join the waitlist" : "Start creating, it\u2019s free"} />
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
                </>
              )}
            </Link>
            {!signedIn && (
              <p className="ft-fine mt-3 text-[13.5px] text-foreground/65">
                Already have an account?{" "}
                <Link href="/login" className="font-semibold text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">
                  Log in
                </Link>
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-8 md:contents">
            {COLUMNS.map((col) => (
              <nav key={col.title} aria-label={col.title}>
                <h2 className="ft-head mb-4 font-sans text-[12px] font-semibold uppercase tracking-[0.16em] text-foreground/55">{col.title}</h2>
                <ul className="flex flex-col gap-1">
                  {col.links.filter((l) => !(l.href.startsWith("/#") && hidden.has(l.href.slice(2)))).map((l) => (
                    <li key={l.href} data-sec={l.href.startsWith("/#") ? l.href.slice(2) : undefined}>
                      <AnimatedLink href={l.href} className="footer-link min-h-9 text-[15px] font-medium text-foreground/80 hover:text-foreground">
                        {l.label}
                      </AnimatedLink>
                    </li>
                  ))}
                  {col.title === "Company" && (
                    <li>
                      <CookieSettingsButton animated className="footer-link group/al inline-flex min-h-9 items-center text-[15px] font-medium text-foreground/80 hover:text-foreground" />
                    </li>
                  )}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="ft-rule relative mx-6 flex flex-col gap-4 border-t border-foreground/10 py-6 sm:mx-10 sm:flex-row sm:items-center sm:justify-between">
          <ul className="flex flex-wrap gap-2" aria-label="Publishes to">
            {PLATFORMS.map((p) => (
              <li key={p.id} className="ft-chip inline-flex h-9 items-center gap-2 rounded-full bg-foreground/[0.05] px-3.5 text-[13px] font-medium text-foreground/80">
                <PlatformGlyph platform={p.id} className="h-3.5 w-3.5" />
                {p.label}
              </li>
            ))}
          </ul>
          <a href="#main" className="ft-top inline-flex h-10 items-center gap-2 self-start rounded-full px-4 text-[13.5px] font-semibold text-foreground/80 ring-1 ring-foreground/15 transition-colors hover:bg-foreground hover:text-background sm:self-auto">
            Back to top <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>

        {/* Signed like a signature: a pen draws each letter's outline in turn, the ink floods in, holds, and the word is written again (globals.css fw-pen / fw-ink). */}
        <div ref={wordRef} className="footer-word pointer-events-none select-none">
          <FooterWordmark className="fw-svg" />
        </div>

        <div className="ft-rule ft-fine relative flex flex-col gap-1.5 border-t border-foreground/10 px-6 pb-6 pt-4 text-[12.5px] text-foreground/70 sm:flex-row sm:items-center sm:justify-between sm:px-10">
          <p>&copy; {new Date().getFullYear()} Outlly. All rights reserved. In beta.</p>
          <p>Instagram, YouTube and X are trademarks of their owners. Outlly is not affiliated with them.</p>
        </div>
      </div>
    </footer>
  );
}
