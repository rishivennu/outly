import { BadgeCheck, Gift, Handshake, Sparkles, Sprout, TrendingUp, Wallet } from "lucide-react";
import { Reveal } from "@/components/marketing/Reveal";
import { SectionHead, Shell } from "@/components/marketing/bits";
import { PARTNER_TIER_LABEL, type PartnerTier } from "@/lib/partners/types";

const CARD = "flex h-full flex-col rounded-[24px] border border-foreground/[0.08] bg-card p-7 sm:p-8";
const ICON = "grid h-11 w-11 place-items-center rounded-[12px] bg-lime/15 text-lime-ink";
const NOTE = "mt-6 max-w-2xl text-pretty text-[14px] leading-relaxed text-muted-foreground";

const TIERS: { tier: PartnerTier; range: string; body: string; icon: typeof Sprout }[] = [
  { tier: "emerging", range: "1K to 5K followers", body: "A close audience that trusts your picks. Small and engaged beats big and quiet.", icon: Sprout },
  { tier: "growing", range: "5K to 10K followers", body: "A steady audience and a regular posting rhythm, ready for planned campaigns.", icon: TrendingUp },
  { tier: "established", range: "10K+ followers", body: "Wide reach and a track record, suited to longer partnerships and series.", icon: BadgeCheck },
];

const OPTIONS = [
  {
    tag: "Option A",
    title: "Paid Collaboration",
    body: "Compensation agreed per campaign. It depends on your reach, the quality of your content, the format and the scope of the work.",
    icon: Wallet,
  },
  {
    tag: "Option B",
    title: "Complimentary Creator Subscription",
    body: "One to two months of the Creator plan to make content with. Ongoing partners can have it extended.",
    icon: Gift,
  },
  {
    tag: "Option C",
    title: "Custom",
    body: "Longer-term partnerships, affiliate arrangements and content we create together.",
    icon: Handshake,
  },
];

const CRITERIA = [
  "Engagement rate",
  "Average views",
  "Likes, comments, shares and saves",
  "Audience location and age range",
  "Content quality and consistency",
  "Niche fit: tech, AI tools, productivity, creators, business",
  "Past brand collaborations",
  "Ability to demonstrate Outlly",
];

const STEPS = [
  { n: "01", title: "Apply", body: "Tell us about you, your channels and the content you would make." },
  { n: "02", title: "We review", body: "We look at your audience, your content and how well Outlly fits it." },
  { n: "03", title: "Get your offer", body: "If it is a match, you get an offer with the terms written out in full." },
  { n: "04", title: "Create and grow", body: "Make the content, share Outlly and track how your posts perform." },
];

export function WhoCanPartner() {
  return (
    <section className="scroll-mt-24 pb-16 pt-20 sm:pb-20 sm:pt-28" aria-labelledby="partners-who">
      <Shell>
        <SectionHead id="partners-who" eyebrow="Who can partner" title="Creators at every stage." />
        <ul className="mt-12 grid gap-4 md:grid-cols-3">
          {TIERS.map((t, i) => (
            <Reveal as="li" key={t.tier} delay={i * 0.06}>
              <article className={CARD}>
                <span className={ICON} aria-hidden="true">
                  <t.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-6 text-xl font-semibold tracking-tight">{PARTNER_TIER_LABEL[t.tier]}</h3>
                <p className="mt-1 text-[15px] font-medium text-lime-ink">{t.range}</p>
                <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{t.body}</p>
              </article>
            </Reveal>
          ))}
        </ul>
        <p className={NOTE}>Tiers are indicative. We review every application on fit, not size.</p>
      </Shell>
    </section>
  );
}

export function WhatYouGet() {
  return (
    <section className="scroll-mt-24 py-16 sm:py-20" aria-labelledby="partners-get">
      <Shell>
        <SectionHead id="partners-get" eyebrow="What you can get" title="Three ways to work together." />
        <ul className="mt-12 grid gap-4 md:grid-cols-3">
          {OPTIONS.map((o, i) => (
            <Reveal as="li" key={o.tag} delay={i * 0.06}>
              <article className={CARD}>
                <span className={ICON} aria-hidden="true">
                  <o.icon className="h-5 w-5" />
                </span>
                <p className="mt-6 text-[13px] font-semibold text-muted-foreground">{o.tag}</p>
                <h3 className="mt-1 text-xl font-semibold tracking-tight">{o.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{o.body}</p>
              </article>
            </Reveal>
          ))}
        </ul>
        <p className={NOTE}>Every offer is agreed individually after review. Applying does not guarantee payment or a subscription.</p>
      </Shell>
    </section>
  );
}

export function WhatWeLookFor() {
  return (
    <section className="scroll-mt-24 py-16 sm:py-20" aria-labelledby="partners-look">
      <Shell>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <SectionHead
            id="partners-look"
            eyebrow="What we look for"
            title="Fit, quality and an engaged audience."
            body="Follower count alone never decides it."
          />
          <Reveal as="ul" stagger className="grid gap-3 sm:grid-cols-2">
            {CRITERIA.map((c) => (
              <li key={c} className="flex min-h-14 items-start gap-3 rounded-[16px] bg-foreground/[0.03] px-4 py-3.5 text-[15px] leading-snug">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-lime-ink" aria-hidden="true" />
                <span>{c}</span>
              </li>
            ))}
          </Reveal>
        </div>
      </Shell>
    </section>
  );
}

export function PartnerSteps() {
  return (
    <section id="how" className="scroll-mt-24 py-16 sm:py-20" aria-labelledby="partners-how">
      <Shell>
        <SectionHead id="partners-how" eyebrow="How it works" title="Four steps from hello to live." />
        <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((st, i) => (
            <Reveal as="li" key={st.n} delay={i * 0.06}>
              <div className={CARD}>
                <span className="display block text-[2.4rem] text-lime-ink" aria-hidden="true">
                  {st.n}
                </span>
                <h3 className="mt-4 text-xl font-semibold tracking-tight">
                  <span className="sr-only">Step {Number(st.n)}: </span>
                  {st.title}
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{st.body}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </Shell>
    </section>
  );
}

export function PartnersContactBand() {
  return (
    <section className="pb-24 pt-8 sm:pb-32" aria-label="Contact the partnerships team">
      <Shell>
        <Reveal>
          <div className="flex flex-col items-start justify-between gap-5 rounded-[24px] bg-[#173A24] px-7 py-8 text-white sm:flex-row sm:items-center sm:px-10">
            <p className="text-pretty text-xl font-semibold tracking-tight">Questions first?</p>
            <a
              href="mailto:partners@outlly.com"
              className="inline-flex min-h-11 items-center rounded-full bg-[#B5FF00] px-5 text-[15px] font-semibold text-[#0b1a00] transition-transform active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B5FF00]"
            >
              Write to partners@outlly.com
            </a>
          </div>
        </Reveal>
      </Shell>
    </section>
  );
}
