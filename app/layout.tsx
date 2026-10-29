import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Bricolage_Grotesque, DM_Sans, Fraunces, Instrument_Serif, Plus_Jakarta_Sans } from "next/font/google";
import localFont from "next/font/local";
import { MotionRoot } from "@/components/shared/MotionRoot";
import { themeScript } from "@/lib/theme/script";
import { CookieBanner } from "@/components/shared/CookieConsent";
import { DeviceHint } from "@/components/shared/DeviceHint";
import { Connectivity, Ripples } from "@/components/shared/Connectivity";
import { LazyChat } from "@/components/support/LazyChat";
import { SmoothScroll } from "@/components/marketing/SmoothScroll";
import { ScrollProgress } from "@/components/shared/ScrollProgress";
import { PageScrollbar } from "@/components/marketing/PageScrollbar";
import "./globals.css";
import "./mobile-app.css";
import { appScript } from "@/lib/app-mode";

/*
 * Type system. Display: Bricolage Grotesque (optical sizes, a little ink-trap warmth).
 * Body: DM Sans, a humanist geometric that reads soft at 15-17px. Accent: Instrument
 * Serif italic, used for one word per headline at most. All self-hosted by next/font,
 * swap + size-adjusted fallbacks, so there is no layout shift and no third-party request.
 */
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap", axes: ["opsz", "wdth"] });
// No opsz axis (10-16): it tripled the file (132 KB) for a change you can't see at 15-17px.
const body = DM_Sans({ subsets: ["latin"], variable: "--font-dmsans", display: "swap" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["italic"], variable: "--font-instrument", display: "swap" });
/*
 * 1046: Admin > Site fonts can swap the whole set (lib/fonts.ts). These raw names feed the role variables
 * (--font-display / --font-body / --font-serif) in globals.css; /api/pip-theme overrides the roles.
 * The Go fonts (BSD, app/fonts/go) are declared but not preloaded, so nobody downloads them unless picked.
 */
const gopher = localFont({
  src: [
    { path: "./fonts/go/go-regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/go/go-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/go/go-medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/go/go-medium-italic.woff2", weight: "500", style: "italic" },
    { path: "./fonts/go/go-bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-gopher",
  display: "swap",
  preload: false,
});
// Fourth set (Admin > Site fonts > Jakarta + Fraunces). Declared only; downloaded when that set is live.
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap", preload: false });
const fraunces = Fraunces({ subsets: ["latin"], style: ["italic"], variable: "--font-fraunces", display: "swap", preload: false });

import { LaunchHost } from "@/components/billing/RocketCta";
import { LiquidGlass } from "@/components/shared/LiquidGlass";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3040"),
  title: { default: "Outlly · Create once. Publish everywhere.", template: "%s · Outlly" },
  description: "Upload one video, let AI tailor it for Instagram Reels, YouTube Shorts and X, then publish and track every destination from one creative workspace.",
  openGraph: { title: "Outlly", description: "Your content deserves to be everywhere.", type: "website" },
  // Google Search Console ownership tag. Set GOOGLE_SITE_VERIFICATION in Vercel to the content="..." value only.
  // Copyright notice in the page head; the visible one sits in the footer.
  other: { copyright: `\u00A9 ${new Date().getFullYear()} Outlly. All rights reserved.` },
  verification: { google: process.env.GOOGLE_SITE_VERIFICATION?.trim() || undefined },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0c0c0e", viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // The Content Security Policy only runs scripts carrying this request's nonce (set by middleware.ts).
  const nonce = headers().get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={`dark ${display.variable} ${body.variable} ${serif.variable} ${gopher.variable} ${jakarta.variable} ${fraunces.variable}`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* Inside the Android app: mark <html> before first paint so the app layout (app/mobile-app.css) never flashes the web one. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: appScript }} />
        {/* Landing sections the admin hid (readable hint cookie set by middleware): mark <html> before the
            first paint so CSS drops their nav and footer links at once, instead of a link flashing in and out. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: `try{var m=document.cookie.match(/(?:^|; )outlly_lh=([^;]*)/);if(m)document.documentElement.setAttribute("data-lh",decodeURIComponent(m[1]).split(".").join(" "))}catch(e){}` }} />
        {/* Pip colourways (Admin > Mascot colours) and the site font set (Admin > Site fonts). Tiny, cached;
            without it Pip is Indigo and the fonts are the originals. */}
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link rel="stylesheet" href="/api/pip-theme" />
      </head>
      <body className="font-sans antialiased">
        <MotionRoot>
          <SmoothScroll />
          <ScrollProgress />
          <PageScrollbar />
          {children}
          <LazyChat />
          <CookieBanner />
          <DeviceHint />
          <Connectivity />
          <Ripples />
          <LaunchHost />
          <LiquidGlass />
        </MotionRoot>
      </body>
    </html>
  );
}
