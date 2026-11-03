import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Archivo, Bricolage_Grotesque, DM_Sans, Fraunces, Inter, Instrument_Serif, Manrope, Plus_Jakarta_Sans, Rubik, Space_Mono, Tinos } from "next/font/google";
import localFont from "next/font/local";
import { MotionRoot } from "@/components/shared/MotionRoot";
import { themeScript } from "@/lib/theme/script";
import { THEME_COLOR } from "@/lib/theme/colors";
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
import { railScript } from "@/lib/rail";
import { welcomeScript } from "@/lib/pwa-welcome";
import { installCaptureScript } from "@/lib/pwa-core";
import { chunkScript } from "@/lib/client/chunk-reload";

/*
 * Type system (1062). Display: Manrope, a clean geometric grotesk that holds up at 48px and at 16px.
 * Body: Inter, built for screens, very readable at 14-17px. Accent: Instrument Serif italic, used for
 * one word per headline at most. All self-hosted by next/font, swap + size-adjusted fallbacks, so there
 * is no layout shift and no third-party request. Both are variable fonts: one file each covers 400-800.
 */
const display = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const body = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// The pre-1062 pair, kept as Admin > Site fonts > "Outlly classic". Declared only; downloaded when that set is live.
// No opsz axis on DM Sans (10-16): it tripled the file (132 KB) for a change you can't see at 15-17px.
const classicDisplay = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap", axes: ["opsz", "wdth"], preload: false });
const classicBody = DM_Sans({ subsets: ["latin"], variable: "--font-dmsans", display: "swap", preload: false });
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
// 1063: "Acumin Pro + Times New Roman" and "Magnode + Alpha Lyrae". Open stand-ins for the paid faces (lib/fonts.ts).
// Declared only, so nobody downloads them unless that set is live.
const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", display: "swap", axes: ["wdth"], preload: false });
const tinos = Tinos({ subsets: ["latin"], weight: ["400", "700"], style: ["normal", "italic"], variable: "--font-tinos", display: "swap", preload: false });
const rubik = Rubik({ subsets: ["latin"], variable: "--font-rubik", display: "swap", preload: false });
const spaceMono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], style: ["normal", "italic"], variable: "--font-spacemono", display: "swap", preload: false });

import { LaunchHost } from "@/components/billing/RocketCta";
import { LiquidGlass } from "@/components/shared/LiquidGlass";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3040"),
  title: { default: "Outlly · Create once. Publish everywhere.", template: "%s · Outlly" },
  description: "Upload one video, let AI tailor it for Instagram Reels, YouTube Shorts and X, then publish and track every destination from one creative workspace.",
  openGraph: { title: "Outlly", description: "Your content deserves to be everywhere.", type: "website" },
  // Google Search Console ownership tag. Set GOOGLE_SITE_VERIFICATION in Vercel to the content="..." value only.
  // Copyright notice in the page head; the visible one sits in the footer.
  other: { copyright: `\u00A9 ${new Date().getFullYear()} Outlly. All rights reserved.`, "apple-mobile-web-app-capable": "yes" },
  verification: { google: process.env.GOOGLE_SITE_VERIFICATION?.trim() || undefined },
  // 1099: launched from the iOS Home Screen it opens full screen with this name under the icon (app/apple-icon.png).
  // 1105: status bar style stays "default", on purpose. iOS then paints the strip behind the time and battery in the
  // theme-color (set to the page background of the active theme by the head script and the theme switch) and picks
  // dark or light indicators to suit it. "black-translucent" would put the app under the bar, but its indicators are
  // always white, so they vanish on the light theme. Next 15 only writes the new "mobile-web-app-capable" tag;
  // iOS before 16.4 needs the apple- one (in `other` below) to open full screen.
  appleWebApp: { capable: true, title: "Outlly", statusBarStyle: "default" },
  applicationName: "Outlly",
};

// Round 1 (1102): an app, not a page, so phones never zoom (pinch, double tap or focusing a field). The user asked
// for it; iOS Safari still allows pinch whatever this says, and every field is 16px on phones (globals.css), so
// nothing needs zooming to read or type.
// 1105: one theme-color, the dark page background (the default theme). The head script (lib/theme/script.ts) runs
// right after this tag and swaps it to the saved theme before the first paint; ThemeToggle keeps it in step after.
// Not a light/dark media pair: that follows the phone's setting, not the theme picked inside Outlly.
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, themeColor: THEME_COLOR.dark, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The Content Security Policy only runs scripts carrying this request's nonce (set by middleware.ts).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={`dark ${display.variable} ${body.variable} ${classicDisplay.variable} ${classicBody.variable} ${serif.variable} ${gopher.variable} ${jakarta.variable} ${fraunces.variable} ${archivo.variable} ${tinos.variable} ${rubik.variable} ${spaceMono.variable}`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* 1079: a tab left open across a deploy reloads once instead of hanging on a chunk the new build dropped. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: chunkScript }} />
        {/* Inside the Android app: mark <html> before first paint so the app layout (app/mobile-app.css) never flashes the web one. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: appScript }} />
        {/* Pulse rail open or closed (1100), before paint so the page column never jumps. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: railScript }} />
        {/* First launch from the Home Screen (1100): paint the welcome first, never a flash of the dashboard. After appScript. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: welcomeScript }} />
        {/* 1099: keep the browser's one-time install prompt for the studio's "Add to Home Screen" card. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: installCaptureScript }} />
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
