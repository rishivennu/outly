"use client";
import Link from "next/link";
import { useSignedIn } from "./useSignedIn";
import { useWaitlist } from "./useWaitlist";
import { CookieSettingsButton } from "@/components/shared/CookieConsent";
import { ArrowRight, ArrowUp, LayoutDashboard } from "lucide-react";
import { OutlyLogo } from "@/components/brand/Logo";
import { PlatformGlyph } from "@/components/shared/PlatformIcon";

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
  const signedIn = useSignedIn();
  const waitlist = useWaitlist();
  return (
    <footer className="px-3 pb-3 pt-6 sm:px-6 sm:pb-6">
      <div className="footer-card relative mx-auto max-w-[1240px] overflow-hidden rounded-[32px] sm:rounded-[40px]">
        <div className="relative grid gap-10 px-6 pb-8 pt-10 sm:px-10 sm:pt-14 md:grid-cols-[1.5fr_1fr_1fr] md:gap-8">
          <div>
            <OutlyLogo size={28} className="text-[20px]" />
            <p className="mt-4 max-w-sm text-[15.5px] leading-relaxed text-foreground/75">
              Upload once. Publish to Reels, Shorts and X. See exactly what happened to each one.
            </p>
            <Link
              href={signedIn ? "/home" : waitlist ? "/waitlist" : "/signup"}
              className="lime-glow group mt-6 inline-flex h-12 items-center gap-2 rounded-full bg-lime px-5 text-[15px] font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 hover:-translate-y-px active:scale-95"
            >
              {signedIn ? (
                <>
                  <LayoutDashboard className="h-4 w-4" aria-hidden="true" /> Open your dashboard
                </>
              ) : (
                <>
                  {waitlist ? "Join the waitlist" : "Start creating, it\u2019s free"}
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
                </>
              )}
            </Link>
            {!signedIn && (
              <p className="mt-3 text-[13.5px] text-foreground/65">
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
                <h2 className="mb-4 font-sans text-[12px] font-semibold uppercase tracking-[0.16em] text-foreground/55">{col.title}</h2>
                <ul className="flex flex-col gap-1">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="footer-link inline-flex min-h-9 items-center text-[15px] font-medium text-foreground/80 hover:text-foreground">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                  {col.title === "Company" && (
                    <li>
                      <CookieSettingsButton className="footer-link inline-flex min-h-9 items-center text-[15px] font-medium text-foreground/80 hover:text-foreground" />
                    </li>
                  )}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="relative mx-6 flex flex-col gap-4 border-t border-foreground/10 py-6 sm:mx-10 sm:flex-row sm:items-center sm:justify-between">
          <ul className="flex flex-wrap gap-2" aria-label="Publishes to">
            {PLATFORMS.map((p) => (
              <li key={p.id} className="inline-flex h-9 items-center gap-2 rounded-full bg-foreground/[0.05] px-3.5 text-[13px] font-medium text-foreground/80">
                <PlatformGlyph platform={p.id} className="h-3.5 w-3.5" />
                {p.label}
              </li>
            ))}
          </ul>
          <a href="#main" className="inline-flex h-10 items-center gap-2 self-start rounded-full px-4 text-[13.5px] font-semibold text-foreground/80 ring-1 ring-foreground/15 transition-colors hover:bg-foreground hover:text-background sm:self-auto">
            Back to top <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>

        <p aria-hidden="true" className="footer-word pointer-events-none select-none px-4 text-center font-display font-bold leading-[0.8]">
          outlly
        </p>

        <div className="relative flex flex-col gap-1.5 px-6 pb-6 pt-2 text-[12.5px] text-foreground/60 sm:flex-row sm:items-center sm:justify-between sm:px-10">
          <p>&copy; {new Date().getFullYear()} Outlly. In beta.</p>
          <p>Instagram, YouTube and X are trademarks of their owners. Outlly is not affiliated with them.</p>
        </div>
      </div>
    </footer>
  );
}
