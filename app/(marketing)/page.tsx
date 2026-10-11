import type { Metadata } from "next";
import { Hero } from "@/components/marketing/Hero";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { Features } from "@/components/marketing/Features";
import { Difference } from "@/components/marketing/Difference";
import { Platforms } from "@/components/marketing/Platforms";
import { Demo } from "@/components/marketing/Demo";
import { Comparison } from "@/components/marketing/Comparison";
import { Pricing } from "@/components/marketing/Pricing";
import { Faq } from "@/components/marketing/Faq";
import { FinalCta } from "@/components/marketing/FinalCta";
import { RouteRule, Shell } from "@/components/marketing/bits";
import { FAQS, HERO } from "@/lib/marketing/content";

const DESCRIPTION =
  "Upload one video. Outly's AI tailors the caption, hook, hashtags and title for Instagram Reels, YouTube Shorts and X, then publishes or schedules it and tracks every destination separately. Free during beta.";

export const metadata: Metadata = {
  title: "Outly · Your content deserves to be everywhere",
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
    siteName: "Outly",
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

export default function LandingPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <Hero />
      <Shell>
        <RouteRule />
      </Shell>
      <HowItWorks />
      <Features />
      <Demo />
      <Difference />
      <Platforms />
      <Comparison />
      <Pricing />
      <Faq />
      <FinalCta />
    </>
  );
}
