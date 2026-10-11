import { cookies } from "next/headers";
import { MarketingNav } from "@/components/marketing/Nav";
import { MarketingFooter } from "@/components/marketing/Footer";
import { SmoothScroll } from "@/components/marketing/SmoothScroll";
import { SESSION_COOKIE } from "@/lib/session-cookie";

/** Shell for every public page: one nav, one footer, one skip link. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  // Cookie presence only (no DB hit): a stale cookie just lands on /home, which re-checks and redirects to login.
  const signedIn = Boolean(cookies().get(SESSION_COOKIE)?.value);
  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-[100] focus-visible:rounded-full focus-visible:bg-foreground focus-visible:px-5 focus-visible:py-3 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-background"
      >
        Skip to content
      </a>
      <SmoothScroll />
      <MarketingNav signedIn={signedIn} />
      <main id="main">{children}</main>
      <MarketingFooter signedIn={signedIn} />
    </div>
  );
}
