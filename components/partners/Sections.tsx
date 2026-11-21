import type { CSSProperties } from "react";
import Link from "next/link";
import { Reveal } from "@/components/marketing/Reveal";
import { Shell } from "@/components/marketing/bits";
import { PARTNER_TIER_LABEL, type PartnerTier } from "@/lib/partners/types";
import { cn } from "@/lib/utils";
import s from "./sections.module.css";

const SECTION_TITLE = "play text-balance text-[clamp(2rem,2.4vw+1rem,3rem)]";
const NOTE = "mt-6 max-w-2xl text-pretty text-[14px] leading-relaxed text-muted-foreground";

type Tone = "lavender" | "blush" | "moss" | "butter" | "apricot" | "sky";

const TIERS: {
  tier: PartnerTier;
  range: string;
  body: string;
  tone: Tone;
  card: { initials: string; handle: string; followers: string; bars: [number, number, number]; tilt: string };
}[] = [
  {
    tier: "emerging",
    range: "1K to 5K followers",
    body: "A close audience that trusts your picks. Small and engaged beats big and quiet.",
    tone: "sky",
    card: { initials: "MK", handle: "@mira.makes", followers: "3.2K followers", bars: [55, 80, 65], tilt: "-6deg" },
  },
  {
    tier: "growing",
    range: "5K to 10K followers",
    body: "A steady audience and a regular posting rhythm, ready for planned campaigns.",
    tone: "butter",
    card: { initials: "DS", handle: "@dev.ships", followers: "7.8K followers", bars: [45, 70, 90], tilt: "5deg" },
  },
  {
    tier: "established",
    range: "10K+ followers",
    body: "Wide reach and a track record, suited to longer partnerships and series.",
    tone: "blush",
    card: { initials: "AR", handle: "@ana.reviews", followers: "24K followers", bars: [70, 60, 85], tilt: "-4deg" },
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

const STEPS: { n: string; title: string; body: string; tone: Tone }[] = [
  { n: "01", title: "Apply", body: "Tell us about you, your channels and the content you would make.", tone: "lavender" },
  { n: "02", title: "We review", body: "We look at your audience, your content and how well Outlly fits it.", tone: "moss" },
  { n: "03", title: "Get your offer", body: "If it is a match, you get an offer with the terms written out in full.", tone: "apricot" },
  { n: "04", title: "Create and grow", body: "Make the content, share Outlly and track how your posts perform.", tone: "sky" },
];

function Head({ id, eyebrow, title, body }: { id: string; eyebrow: string; title: string; body?: string }) {
  return (
    <Reveal y={0} className="max-w-2xl">
      <p className="eyebrow mb-5">{eyebrow}</p>
      <h2 id={id} className={SECTION_TITLE}>
        {title}
      </h2>
      {body && <p className="mt-4 text-pretty text-[15px] leading-relaxed text-muted-foreground sm:text-base">{body}</p>}
    </Reveal>
  );
}

function CreatorCard({ card }: { card: (typeof TIERS)[number]["card"] }) {
  const style = { "--tilt": card.tilt } as CSSProperties;
  return (
    <div className={s.stage} aria-hidden="true">
      <div className={s.creator} style={style}>
        <div className={s.creatorTop}>
          <span className={s.avatar}>{card.initials}</span>
          <div className="min-w-0">
            <p className={s.handle}>{card.handle}</p>
            <span className={s.pill}>{card.followers}</span>
          </div>
        </div>
        <div className={s.engage}>
          <span>Engagement</span>
          <span className={s.bars}>
            {card.bars.map((h, i) => (
              <span key={i} className={s.bar} style={{ height: `${h}%` }} />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

export function WhoCanPartner() {
  return (
    <section id="who" className="scroll-mt-24 py-16 sm:py-20" aria-labelledby="partners-who">
      <Shell>
        <Head id="partners-who" eyebrow="Who can partner" title="Creators at every stage." />
        <ul className="mt-12 grid gap-4 md:grid-cols-3">
          {TIERS.map((t, i) => (
            <Reveal as="li" key={t.tier} delay={i * 0.06} className="min-w-0">
              <article className={cn(s.tile, s.tierTile, s[t.tone])} style={{ "--float-delay": `${-2 * i}s` } as CSSProperties}>
                <h3 className={cn("play", s.title)}>{PARTNER_TIER_LABEL[t.tier]}</h3>
                <p className={s.range}>{t.range}</p>
                <p className={s.body}>{t.body}</p>
                <CreatorCard card={t.card} />
              </article>
            </Reveal>
          ))}
        </ul>
        <p className={NOTE}>Tiers are indicative. We review every application on fit, not size.</p>
      </Shell>
    </section>
  );
}

// The partners bento replaced the three options; kept as a no-op export so older imports still resolve.
export function WhatYouGet() {
  return null;
}

export function WhatWeLookFor() {
  return (
    <section className="scroll-mt-24 py-16 sm:py-20" aria-labelledby="partners-look">
      <Shell>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-16">
          <Head
            id="partners-look"
            eyebrow="What we look for"
            title="Fit, quality and an engaged audience."
            body="Follower count alone never decides it."
          />
          <Reveal as="ul" stagger className={s.chips}>
            {CRITERIA.map((c) => (
              <li key={c} className={s.chip}>
                {c}
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
        <Head id="partners-how" eyebrow="How it works" title="Four steps from hello to live." />
        <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((st, i) => (
            <Reveal as="li" key={st.n} delay={i * 0.06} className="min-w-0">
              <div className={cn(s.tile, s.stepTile, s[st.tone])}>
                <span className={cn("play", s.numeral)} aria-hidden="true">
                  {st.n}
                </span>
                <h3 className={cn("play", s.title)}>
                  <span className="sr-only">Step {Number(st.n)}: </span>
                  {st.title}
                </h3>
                <p className={s.body}>{st.body}</p>
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
    <section className="pb-24 pt-8 sm:pb-32" aria-labelledby="partners-contact">
      <Shell>
        <Reveal>
          <div className={cn(s.tile, s.deep, s.band)}>
            <h2 id="partners-contact" className={cn("play", s.bandTitle)}>
              Questions first?
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href="mailto:partners@outlly.com"
                className="inline-flex min-h-11 items-center rounded-full bg-[#B5FF00] px-5 text-[15px] font-semibold text-[#0b1a00] transition-transform active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B5FF00]"
              >
                Write to partners@outlly.com
              </a>
              <Link
                href="/help"
                className="inline-flex min-h-11 items-center rounded-full border border-[#E9FFE0]/40 px-5 text-[15px] font-semibold text-[#E9FFE0] transition-colors hover:bg-[#E9FFE0]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E9FFE0]"
              >
                Read the FAQ
              </Link>
            </div>
          </div>
        </Reveal>
      </Shell>
    </section>
  );
}
