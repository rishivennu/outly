import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Hero } from "@/components/marketing/Hero";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { Features } from "@/components/marketing/Features";
import { WhyOutlly } from "@/components/marketing/WhyOutlly";
import { Difference } from "@/components/marketing/Difference";
import { Platforms } from "@/components/marketing/Platforms";
import { LogoTicker } from "@/components/marketing/LogoTicker";
import { TryIt } from "@/components/marketing/TryIt";
import { Demo } from "@/components/marketing/Demo";
import { Comparison } from "@/components/marketing/Comparison";
import { Pricing } from "@/components/marketing/Pricing";
import { TimeSaved } from "@/components/marketing/TimeSaved";
import { Trust } from "@/components/marketing/Trust";
import { Faq } from "@/components/marketing/Faq";
import { FinalCta } from "@/components/marketing/FinalCta";
import { RouteRule } from "@/components/marketing/bits";
import { FAQS, HERO } from "@/lib/marketing/content";
import { getConfig } from "@/lib/settings";
import { isBeta } from "@/lib/beta";
import { siteStatus, waitlistCounts } from "@/lib/site";
import { WaitlistJoin } from "@/components/marketing/WaitlistJoin";
import { shown } from "@/lib/landing";
import { Countdown } from "@/components/maintenance/Countdown";
import { ScrollScenes } from "@/components/marketing/ScrollScenes";
import { LandingFx } from "@/components/marketing/LandingFx";
import { liveNow } from "@/lib/social/registry";

// Rendered per request: prices follow the visitor's country, and the platform list follows the admin's keys.
export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Upload one video. Outlly's AI writes the caption, hook and hashtags for Reels, Shorts and X, then publishes it and tracks every post.";

export async function generateMetadata(): Promise<Metadata> {
  const beta = await isBeta();
  return { ...metadata, description: `${DESCRIPTION} ${beta ? "Free during beta." : "Start free."}` };
}

const metadata: Metadata = {
  // The root layout appends " · Outlly" to every title, so the home title sets itself absolutely.
  title: { absolute: "Outlly · Your content deserves to be everywhere" },
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

/**
 * 1181: one sheet of the landing's pinned-panel stack (lib/motion/panels.ts, built by ScrollScenes on screens 768px and
 * up with motion allowed). Until then, and everywhere else, it is a plain block. `flow`: slides over the sheet before it
 * but is never pinned itself (Comparison pins its own header row).
 */
function Panel({ children, flow = false }: { children: React.ReactNode; flow?: boolean }) {
  return (
    <div className="lp-panel" data-panel={flow ? "flow" : "pin"}>
      {children}
    </div>
  );
}

export default async function LandingPage() {
  // Both reads are cached in-process for 15 s, so this costs nothing on a busy page.
  const [cfg, site, beta, live] = await Promise.all([getConfig("landing"), siteStatus(), isBeta(), liveNow()]);
  const on = (id: Parameters<typeof shown>[1]) => shown(cfg, id);
  // Waitlist mode (1137): the whole page stays, plus the sign-up section before the footer. Members (the readable
  // signed-in hint the middleware keeps in step) already have an account, so they don't get the form.
  const joinOpen = site.waitlist && (await cookies()).get("outlly_in")?.value !== "1";
  const joined = joinOpen ? (await waitlistCounts()).total : 0;
  return (
    <>
      {on("faq") && <script type="application/ld+json" nonce={(await headers()).get("x-nonce") ?? undefined} dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c") }} />}
      {/* Only members and admins reach the landing page during maintenance; they get the countdown here. */}
      {site.maintenance && site.endsAt && (
        <div className="mx-auto mt-4 w-fit max-w-[calc(100%-2.5rem)] rounded-[22px] bg-[hsl(var(--lime)/0.16)] px-4 py-2 hairline">
          <Countdown endsAt={site.endsAt} since={site.since} variant="bar" />
        </div>
      )}
      {/* 1181: the sections as sheets of the pinned-panel stack (Panel above). The ticker rides with the hero, the route
          line with Try it, and the waitlist form with the final call to action, so no sheet is a thin strip. */}
      {on("hero") && (
        <Panel>
          <Hero showHow={on("how")} beta={beta} live={live} />
          <LogoTicker live={live} />
        </Panel>
      )}
      {/* Why Outlly (1161): the six strengths straight after the hero, its own switch in Admin > Landing page. */}
      {on("usp") && <Panel><WhyOutlly live={live} /></Panel>}
      {/* Try it (10-28): its own switch in Admin > Landing page. Off also closes /api/try. */}
      {(on("try") || (on("hero") && on("how"))) && (
        <Panel>
          {on("try") && <TryIt />}
          {on("hero") && on("how") && (
            // Same box as the framed fan stage (HeroFan: w-full max-w-[1180px]) so the dotted line runs edge to edge with it.
            <div className="mx-auto w-full max-w-[1180px]">
              <RouteRule />
            </div>
          )}
        </Panel>
      )}
      {!on("hero") && <div className="h-6" aria-hidden="true" />}
      {on("how") && <Panel><HowItWorks /></Panel>}
      {on("features") && <Panel><Features /></Panel>}
      {on("time") && <Panel><TimeSaved /></Panel>}
      {on("demo") && <Panel><Demo /></Panel>}
      {on("why") && <Panel><Difference beta={beta} /></Panel>}
      {on("platforms") && <Panel><Platforms showCompare={on("compare")} /></Panel>}
      {on("compare") && <Panel flow><Comparison competitors={cfg.competitors} groups={cfg.groups} beta={beta} /></Panel>}
      {on("trust") && <Panel><Trust /></Panel>}
      {on("pricing") && <Panel><Pricing /></Panel>}
      {on("faq") && <Panel><Faq /></Panel>}
      {(on("cta") || joinOpen) && (
        <Panel>
          {on("cta") && <FinalCta beta={beta} />}
          {joinOpen && <WaitlistJoin beta={beta} total={joined} />}
        </Panel>
      )}
      {/* A page with every section off still needs a heading for screen readers and a way in. */}
      {!on("hero") && <h1 className="sr-only">Outlly</h1>}
      <ScrollScenes />
      <LandingFx />
    </>
  );
}
