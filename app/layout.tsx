import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, DM_Sans, Instrument_Serif } from "next/font/google";
import { MotionRoot } from "@/components/shared/MotionRoot";
import { themeScript } from "@/lib/theme/script";
import { CookieBanner } from "@/components/shared/CookieConsent";
import { Connectivity, Ripples } from "@/components/shared/Connectivity";
import { LazyChat } from "@/components/support/LazyChat";
import { SmoothScroll } from "@/components/marketing/SmoothScroll";
import { ScrollProgress } from "@/components/shared/ScrollProgress";
import "./globals.css";

/*
 * Type system. Display: Bricolage Grotesque (optical sizes, a little ink-trap warmth).
 * Body: DM Sans, a humanist geometric that reads soft at 15-17px. Accent: Instrument
 * Serif italic, used for one word per headline at most. All self-hosted by next/font,
 * swap + size-adjusted fallbacks, so there is no layout shift and no third-party request.
 */
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap", axes: ["opsz", "wdth"] });
const body = DM_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap", axes: ["opsz"] });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3040"),
  title: { default: "Outlly · Create once. Publish everywhere.", template: "%s · Outlly" },
  description: "Upload one video, let AI tailor it for Instagram Reels, YouTube Shorts and X, then publish and track every destination from one creative workspace.",
  openGraph: { title: "Outlly", description: "Your content deserves to be everywhere.", type: "website" },
  // Google Search Console ownership tag. Set GOOGLE_SITE_VERIFICATION in Vercel to the content="..." value only.
  verification: { google: process.env.GOOGLE_SITE_VERIFICATION?.trim() || undefined },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0c0c0e" }, { media: "(prefers-color-scheme: light)", color: "#faf8f3" }], viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans antialiased">
        <MotionRoot>
          <SmoothScroll />
          <ScrollProgress />
          {children}
          <LazyChat />
          <CookieBanner />
          <Connectivity />
          <Ripples />
        </MotionRoot>
      </body>
    </html>
  );
}
