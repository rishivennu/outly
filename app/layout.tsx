import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { Archivo, Bricolage_Grotesque, DM_Sans, Fraunces, Inter, Instrument_Serif, Manrope, Plus_Jakarta_Sans, Rubik, Space_Mono, Tinos } from "next/font/google";
import localFont from "next/font/local";
import { themeScript } from "@/lib/theme/script";
import { colorSchemeFor, iosStatusBarStyle, THEME_COOKIE, themeColorFor } from "@/lib/theme/colors";
import { StatusBarSync } from "@/components/shared/StatusBarSync";
import { RootClient } from "@/components/shared/RootClient";
import { swScript } from "@/lib/sw-script";
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
// 1130: our own fallback face (globals.css, "Outlly Bricolage Fallback"), not next/font's. Next sizes Arial to Bricolage's
// default width, but the headlines set it condensed ("wdth" 96), so its fallback ran 8% wide and the hero headline
// broke onto 3 lines on a 390-412px phone, then snapped to 2 when the 131 KB font landed: the card fan under it jumped
// 41px (CLS 0.21 on live mobile). The tuned face matches the condensed width, so the lines break the same either way.
const classicDisplay = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap", axes: ["opsz", "wdth"], preload: false, adjustFontFallback: false, fallback: ["Outlly Bricolage Fallback", "Arial", "sans-serif"] });
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
// R1287: upright too, for the Partner With Us "play" titles (components/partners/*): the warm serif of the bento cards.
const fraunces = Fraunces({ subsets: ["latin"], style: ["normal", "italic"], axes: ["SOFT", "WONK", "opsz"], variable: "--font-fraunces", display: "swap", preload: false });
// 1063: "Acumin Pro + Times New Roman" and "Magnode + Alpha Lyrae". Open stand-ins for the paid faces (lib/fonts.ts).
// Declared only, so nobody downloads them unless that set is live.
const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", display: "swap", axes: ["wdth"], preload: false });
const tinos = Tinos({ subsets: ["latin"], weight: ["400", "700"], style: ["normal", "italic"], variable: "--font-tinos", display: "swap", preload: false });
const rubik = Rubik({ subsets: ["latin"], variable: "--font-rubik", display: "swap", preload: false });
const spaceMono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], style: ["normal", "italic"], variable: "--font-spacemono", display: "swap", preload: false });

import { themeCss } from "@/lib/theme-css";

// R1215: per request, because the iOS status bar style follows the saved theme (see iosStatusBarStyle). The layout
// already reads headers() and cookies() for every request, so this costs nothing extra.
export async function generateMetadata(): Promise<Metadata> {
  const theme = (await cookies()).get(THEME_COOKIE)?.value;
  return {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3040"),
  title: { default: "Outlly · Create once. Publish everywhere.", template: "%s · Outlly" },
  description: "Upload one video, let AI tailor it for Instagram Reels, YouTube Shorts and X, then publish and track every destination from one creative workspace.",
  openGraph: { title: "Outlly", description: "Your content deserves to be everywhere.", type: "website" },
  // Google Search Console ownership tag. Set GOOGLE_SITE_VERIFICATION in Vercel to the content="..." value only.
  // Copyright notice in the page head; the visible one sits in the footer.
  other: { copyright: `\u00A9 ${new Date().getFullYear()} Outlly. All rights reserved.`, "apple-mobile-web-app-capable": "yes" },
  verification: { google: process.env.GOOGLE_SITE_VERIFICATION?.trim() || undefined },
  // 1099: launched from the iOS Home Screen it opens full screen with this name under the icon (app/apple-icon.png).
  // 1105 kept "default" so iOS would paint the strip behind the clock in the theme-color; on the dark theme it
  // painted it white instead (R1215, real iPhone), so dark now runs under the bar and the light theme keeps "default"
  // (its indicators must stay dark). Next 15 only writes the new "mobile-web-app-capable" tag; iOS before 16.4
  // needs the apple- one (in `other` below) to open full screen.
  appleWebApp: { capable: true, title: "Outlly", statusBarStyle: iosStatusBarStyle(theme) },
  applicationName: "Outlly",
  };
}

// Round 1 (1102): an app, not a page, so phones never zoom by accident. Double tap is still blocked by
// `html { touch-action: manipulation }` and focusing a field never zooms because every phone field is 16px
// (both in globals.css), which is what made the page feel like an app.
// 1192: pinch zoom is allowed again (maximumScale 5, userScalable true). Blocking it fails WCAG 1.4.4 and axe
// flags it critical on every page, iOS Safari ignored it anyway, and it is the one zoom a low-vision reader
// actually asks for. The two that made the app feel like a page are still off, so nothing moved by accident.
// 1105: one theme-color, the dark page background (the default theme). The head script (lib/theme/script.ts) runs
// right after this tag and swaps it to the saved theme before the first paint; ThemeToggle keeps it in step after.
// Not a light/dark media pair: that follows the phone's setting, not the theme picked inside Outlly.
// 1107/1108: the theme-color in the first HTML follows the theme saved in the cookie, because an iPhone Home Screen
// app reads it as the page arrives. Root layout reads headers() for the nonce, so every page renders per request
// anyway and reading the cookie costs nothing. Public pages override it for their own light background.
export async function generateViewport(): Promise<Viewport> {
  return { width: "device-width", initialScale: 1, maximumScale: 5, userScalable: true, themeColor: themeColorFor((await cookies()).get(THEME_COOKIE)?.value), viewportFit: "cover", colorScheme: colorSchemeFor((await cookies()).get(THEME_COOKIE)?.value) };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The Content Security Policy only runs scripts carrying this request's nonce (set by middleware.ts).
  // 1192: the browser hides a script's nonce attribute once it has parsed it (so a stolen nonce can't be read back
  // out of the DOM), which means React hydrates and finds nonce="" where the server sent a value. The scripts are
  // fine and already ran; suppressHydrationWarning silences the one warning that reported it on every page.
  // Perf: themeCss comes from the shared data cache and answers the defaults on any failure, so the first byte never waits on the database.
  const [nonce, theme] = await Promise.all([headers().then((h) => h.get("x-nonce") ?? undefined), themeCss()]);
  return (
    <html lang="en" className={`dark ${display.variable} ${body.variable} ${classicDisplay.variable} ${classicBody.variable} ${serif.variable} ${gopher.variable} ${jakarta.variable} ${fraunces.variable} ${archivo.variable} ${tinos.variable} ${rubik.variable} ${spaceMono.variable}`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* 1079: a tab left open across a deploy reloads once instead of hanging on a chunk the new build dropped. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: chunkScript }} />
        {/* Inside the Android app: mark <html> before first paint so the app layout (app/mobile-app.css) never flashes the web one. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: appScript }} />
        {/* Pulse rail open or closed (1100), before paint so the page column never jumps. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: railScript }} />
        {/* First launch from the Home Screen (1100): paint the welcome first, never a flash of the dashboard. After appScript. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: welcomeScript }} />
        {/* 1099: keep the browser's one-time install prompt for the studio's "Add to Home Screen" card. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: installCaptureScript }} />
        {/* Perf: register the service worker on load (production only), so the second launch already has the app shell. */}
        {swScript && <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: swScript }} />}
        {/* Landing sections the admin hid (readable hint cookie set by middleware): mark <html> before the
            first paint so CSS drops their nav and footer links at once, instead of a link flashing in and out. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: `try{var m=document.cookie.match(/(?:^|; )outlly_lh=([^;]*)/);if(m)document.documentElement.setAttribute("data-lh",decodeURIComponent(m[1]).split(".").join(" "))}catch(e){}` }} />
        {/* Pip colourways (Admin > Mascot colours) and the site font set (Admin > Site fonts). Tiny, cached;
            without it Pip is Indigo and the fonts are the originals. */}
        {/* 1113: inlined (about 2 KB) instead of a render-blocking /api/pip-theme request on every first paint. */}
        <style id="pip-theme" dangerouslySetInnerHTML={{ __html: theme }} />
      </head>
      <body className="font-sans antialiased">
        {/* Perf: the client providers live in RootClient; the heavy ones mount after the page has settled. */}
        <RootClient>{children}</RootClient>
        <StatusBarSync />
      </body>
    </html>
  );
}
