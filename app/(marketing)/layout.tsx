import { MarketingNav } from "@/components/marketing/Nav";
import { MarketingFooter } from "@/components/marketing/Footer";

/** Shell for every public page: one nav, one footer, one skip link. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  // No cookies() here: reading a cookie on the server would make every public page render per
  // request. The nav and footer read the signed-in hint in the browser instead (useSignedIn).
  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-[100] focus-visible:rounded-full focus-visible:bg-foreground focus-visible:px-5 focus-visible:py-3 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-background"
      >
        Skip to content
      </a>
      <MarketingNav />
      <main id="main">{children}</main>
      <MarketingFooter />
    </div>
  );
}
