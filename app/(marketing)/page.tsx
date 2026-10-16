import type { Metadata } from "next";
import { Hero } from "@/components/marketing/Hero";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { Features } from "@/components/marketing/Features";
import { Difference } from "@/components/marketing/Difference";
import { Platforms } from "@/components/marketing/Platforms";
import { LogoTicker } from "@/components/marketing/LogoTicker";
import { Demo } from "@/components/marketing/Demo";
import { Comparison } from "@/components/marketing/Comparison";
import { Pricing } from "@/components/marketing/Pricing";
import { Faq } from "@/components/marketing/Faq";
import { FinalCta } from "@/components/marketing/FinalCta";
import { RouteRule } from "@/components/marketing/bits";
import { FAQS, HERO } from "@/lib/marketing/content";
import { getConfig } from "@/lib/settings";
import { siteStatus } from "@/lib/site";
import { shown } from "@/lib/landing";
import { Countdown } from "@/components/maintenance/Countdown";
import { ScrollScenes } from "@/components/marketing/ScrollScenes";

// Rendered per request: prices follow the visitor's country, and the platform list follows the admin's keys.
export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Upload one video. Outlly's AI tailors the caption, hook, hashtags and title for Instagram Reels, YouTube Shorts and X, then publishes or schedules it and tracks every destination separately. Free during beta.";

export const metadata: Metadata = {
  title: "Outlly · Your content deserves to be everywhere",
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  keywords: [
    "publish to Instagram Reels and YouTube Shorts",
    "cross-post short video",
    "AI captions for creators",
    "schedule Reels Shorts X",
    "creator publishing workspace",
  ],
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Outlly",
    title: "Your content deserves to be everywhere.",
    description: HERO.sub,
  },
  twitter: {
    card: "summary_large_image",
    title: "Your content deserves to be everywhere.",
    description: HERO.sub,
  },
};

/** FAQPage structured data, straight from the same copy shown on the page. */
const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

export default async function LandingPage() {
  // Both reads are cached in-process for 15 s, so this costs nothing on a busy page.
  const [cfg, site] = await Promise.all([getConfig("landing"), siteStatus()]);
  const on = (id: Parameters<typeof shown>[1]) => shown(cfg, id);
  return (
    <>
      {on("faq") && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />}
      {/* Only members and admins reach the landing page during maintenance; they get the countdown here. */}
      {site.maintenance && site.endsAt && (
        <div className="mx-auto mt-4 w-fit max-w-[calc(100%-2.5rem)] rounded-[22px] bg-[hsl(var(--lime)/0.16)] px-4 py-2 hairline">
          <Countdown endsAt={site.endsAt} since={site.since} variant="bar" />
        </div>
      )}
      {on("hero") && <Hero showHow={on("how")} />}
      {on("hero") && <LogoTicker />}
      {on("hero") && on("how") && (
        // Same box as the framed fan stage (HeroFan: w-full max-w-[1180px]) so the dotted line runs edge to edge with it.
        <div className="mx-auto w-full max-w-[1180px]">
          <RouteRule />
        </div>
      )}
      {!on("hero") && <div className="h-6" aria-hidden="true" />}
      {on("how") && <HowItWorks />}
      {on("features") && <Features />}
      {on("demo") && <Demo />}
      {on("why") && <Difference />}
      {on("platforms") && <Platforms showCompare={on("compare")} />}
      {on("compare") && <Comparison competitors={cfg.competitors} groups={cfg.groups} />}
      {on("pricing") && <Pricing />}
      {on("faq") && <Faq />}
      {on("cta") && <FinalCta />}
      {/* A page with every section off still needs a heading for screen readers and a way in. */}
      {!on("hero") && <h1 className="sr-only">Outlly</h1>}
      <ScrollScenes />
    </>
  );
}
