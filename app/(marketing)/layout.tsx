import { MarketingNav } from "@/components/marketing/Nav";
import { MarketingFooter } from "@/components/marketing/Footer";
import { MotionFx } from "@/components/marketing/MotionFx";
import { CursorFx } from "@/components/shared/CursorFx";
import { TextFx } from "@/components/shared/TextFx";
import { StarField } from "@/components/marketing/StarField";
import { BetaProvider } from "@/components/marketing/BetaContext";
import { isBeta } from "@/lib/beta";
import { cookies } from "next/headers";
import type { Viewport } from "next";
import { THEME_COOKIE, themeColorFor } from "@/lib/theme/colors";

/**
 * 1108: public pages have their own light background (lib/theme/colors.ts lightSky), so the status bar colour in the
 * first HTML is that one for a light user. Only themeColor; Next keeps the rest of the root layout's viewport.
 * The root layout already renders per request (CSP nonce), so this cookie read does not change caching.
 */
export async function generateViewport(): Promise<Viewport> {
  return { themeColor: themeColorFor((await cookies()).get(THEME_COOKIE)?.value, "sky") };
}

/** Shell for every public page: one nav, one footer, one skip link. */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  // No cookies() here: reading a cookie on the server would make every public page render per
  // request. The nav and footer read the signed-in hint in the browser instead (useSignedIn).
  // The beta switch is a DB setting, not a cookie, so pages stay cacheable; the admin toggle revalidates them.
  const beta = await isBeta();
  return (
    <BetaProvider value={beta}>
    <div className="sky-host min-h-dvh">
      <StarField />
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-[100] focus-visible:rounded-full focus-visible:bg-foreground focus-visible:px-5 focus-visible:py-3 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-background"
      >
        Skip to content
      </a>
      <MarketingNav />
      <main id="main">{children}</main>
      <MarketingFooter />
      <MotionFx />
      <TextFx />
      <CursorFx />
    </div>
    </BetaProvider>
  );
}
