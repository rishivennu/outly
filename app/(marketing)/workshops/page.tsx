import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowUpRight, CalendarCheck, MousePointerClick, Play, PlayCircle } from "lucide-react";
import { Shell } from "@/components/marketing/bits";
import { Carousel } from "@/components/workshops/Carousel";
import { Bubble, Envelope, Heart, Sparkle, Star } from "@/components/workshops/Doodles";
import { WorkshopCard } from "@/components/workshops/WorkshopCard";
import { pixelFont } from "@/components/workshops/fonts";
import s from "@/components/workshops/workshops.module.css";
import { fmtWhen, youtubeId, type WorkshopView } from "@/lib/workshops/core";
import { jsonLdString, listJsonLd } from "@/lib/workshops/jsonld";
import { listPublicWorkshops } from "@/lib/workshops/server";
import { env } from "@/lib/env";
import { pageOn } from "@/lib/landing";
import { getConfig } from "@/lib/settings";
import { notFound } from "next/navigation";
import { cn } from "@/lib/utils";

export const revalidate = 60;

const TITLE = "Free creator workshops";
const LEAD = "Live, hands-on sessions on Google Meet with the Outlly team. Bring your questions, leave with a plan, catch the replay here.";

export const metadata: Metadata = {
  title: TITLE,
  description: LEAD,
  alternates: { canonical: "/workshops" },
  openGraph: { title: `${TITLE} · Outlly`, description: LEAD, url: "/workshops", type: "website" },
  twitter: { card: "summary", title: `${TITLE} · Outlly`, description: LEAD },
};

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const PILL = cn("inline-flex min-h-12 items-center gap-2 rounded-full px-6 text-[15px] font-bold transition", FOCUS);

const STRIP_A = ["Join the Creator Hub", "Free workshops", "Live on Google Meet", "Replays included"];
const STRIP_B = ["Making creator growth simple and fun", "Hooks", "Captions", "Batching", "Analytics"];

const STEPS = [
  { icon: MousePointerClick, title: "Save a seat in one click", body: "Pick a session and register with your Outlly account. No forms, no fees." },
  { icon: CalendarCheck, title: "The invite lands in your calendar", body: "A Google Calendar invite with the Meet link arrives by email. Your calendar handles the time zone." },
  { icon: PlayCircle, title: "Missed it? Watch the replay", body: "Recordings go up on this page after each session, free to watch, forever." },
];

/* Cut-out collage along the hero's bottom edge, built from the brand's own stickers and characters. */
const COLLAGE: { src: string; w: number; h: number; r: number; size: string; lift?: string }[] = [
  { src: "/brand/founding/05-outlly-ring.webp", w: 512, h: 512, r: -8, size: "w-14 sm:w-28" },
  { src: "/brand/welcome/koko-480.webp", w: 480, h: 525, r: 4, size: "w-20 sm:w-36", lift: "-mb-2" },
  { src: "/brand/platforms/youtube-192.png", w: 192, h: 192, r: -12, size: "hidden sm:block sm:w-16", lift: "mb-8" },
  { src: "/brand/founding/01-rocket-badge.webp", w: 512, h: 508, r: 6, size: "w-16 sm:w-32" },
  { src: "/brand/founding/04-rocket-flower.webp", w: 512, h: 512, r: -5, size: "hidden sm:block sm:w-24", lift: "mb-6" },
  { src: "/brand/welcome/kiki-480.webp", w: 480, h: 497, r: -3, size: "w-20 sm:w-36", lift: "-mb-1" },
  { src: "/brand/platforms/instagram-192.png", w: 192, h: 192, r: 10, size: "hidden sm:block sm:w-16", lift: "mb-10" },
  { src: "/brand/founding/03-app-tile.webp", w: 512, h: 509, r: 7, size: "w-16 sm:w-28" },
];

async function load(): Promise<{ upcoming: WorkshopView[]; past: WorkshopView[] }> {
  try {
    return await listPublicWorkshops();
  } catch (e) {
    console.warn("[workshops] list unavailable:", e instanceof Error ? e.message : e);
    return { upcoming: [], past: [] };
  }
}

/** Thin mono marquee strip. The sr-only sentence is the accessible copy; the moving track is decoration. */
function Strip({ items, say, dark }: { items: string[]; say: string; dark?: boolean }) {
  const run = (
    <div className="flex shrink-0 items-center">
      {[...items, ...items].map((t, i) => (
        <span key={i} className={cn(s.mono, "flex items-center gap-5 pr-5 text-[12px] font-bold uppercase tracking-[0.2em]")}>
          {t}
          <span aria-hidden="true" className={dark ? "text-[hsl(338_70%_70%)]" : "text-[hsl(var(--pink))]"}>
            ✦
          </span>
        </span>
      ))}
    </div>
  );
  return (
    <div className={cn(s.strip, dark && s.stripDark, "py-2.5")}>
      <p className="sr-only">{say}</p>
      <div className={s.track} aria-hidden="true">
        {run}
        {run}
      </div>
    </div>
  );
}

/** R1310: the admin can take the whole Creator Hub down from /admin/workshops; the page then 404s like it never existed. */
async function pageEnabled() {
  try {
    return pageOn(await getConfig("landing"), "workshops");
  } catch {
    return true;
  }
}

export default async function WorkshopsPage() {
  if (!(await pageEnabled())) notFound();
  const { upcoming, past } = await load();
  const replays = past.filter((w) => w.recordingUrl);
  const base = env.APP_URL.replace(/\/+$/, "");

  return (
    <div className={s.page}>
      {upcoming.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(listJsonLd(upcoming, base)) }} />}

      {/* Hero: sticker tag, mixed-type headline, doodles, two pills, then the cut-out collage on the bottom edge. */}
      <section className="overflow-x-clip pt-12 sm:pt-16">
        <Shell>
          <div className="relative mx-auto max-w-[62rem] text-center">
            <Star className="left-[-2%] top-[-6%] hidden w-14 -rotate-12 md:block lg:left-[2%] lg:w-16" />
            <Sparkle className="right-[4%] top-[-8%] hidden w-10 rotate-12 md:block" color="hsl(44 96% 56%)" />
            <Bubble className="right-[-4%] top-[30%] hidden w-28 rotate-6 lg:block" text="Q&A" />
            <Envelope className="left-[-6%] top-[48%] hidden w-28 -rotate-[9deg] lg:block" />
            <Heart className="left-[14%] bottom-[8%] hidden w-9 -rotate-12 md:block" />
            <Sparkle className="right-[16%] bottom-[2%] hidden w-7 -rotate-6 md:block" />

            <p className={cn(s.tag, s.pink, "mx-auto -rotate-2")}>Creator Hub</p>
            <h1 className="mt-6 text-[clamp(2.75rem,8.6vw,6.5rem)] leading-[0.98] tracking-tight">
              <span className="block">
                <span className={s.chunky}>free </span>
                <span className={cn(pixelFont.className, s.pixel)}>live</span>
              </span>{" "}
              <span className="block">
                <span className={s.outline} data-text="workshops">
                  workshops
                </span>
              </span>{" "}
              <span className={cn(s.soft, "block")}>for creators.</span>
            </h1>
            <p className="mx-auto mt-7 max-w-xl text-pretty text-[17px] leading-relaxed text-muted-foreground sm:text-lg">{LEAD}</p>

            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a href="#upcoming" className={cn(PILL, s.pinkBtn)}>
                See upcoming sessions
                <ArrowDown size={18} aria-hidden="true" />
              </a>
              <a href="#how" className={cn(PILL, s.whiteBtn)}>
                How it works
              </a>
            </div>
          </div>
        </Shell>

        <ul aria-label="Outlly stickers" className={cn(s.collage, "mx-auto mt-10 flex max-w-[1100px] items-end justify-center gap-1 px-2 sm:mt-14 sm:gap-3")}>
          {COLLAGE.map((c) => (
            <li key={c.src} className={cn("shrink-0", c.lift)}>
              <Image src={c.src} alt="" width={c.w} height={c.h} sizes="(min-width: 640px) 144px, 96px" className={cn(s.cut, c.size, "h-auto")} style={{ "--r": `${c.r}deg` } as React.CSSProperties} />
            </li>
          ))}
        </ul>
      </section>

      <Strip items={STRIP_A} say="Join the Creator Hub: free workshops, live on Google Meet, replays included." />

      {/* "join the club" block: big serif, inline pill row. */}
      <section aria-labelledby="club-title" className="py-14 sm:py-20">
        <Shell>
          <div className="mx-auto max-w-[46rem] text-center">
            <h2 id="club-title" className={cn(s.serif, "text-balance text-[clamp(2.4rem,6vw,4.25rem)] leading-[1.02]")}>
              save your <span className={cn(s.soft, "font-black")}>seat</span>, it&apos;s free.
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-[16px] leading-relaxed text-muted-foreground sm:text-[17px]">
              Every session is free with an Outlly account. Register once, the invite shows up in your calendar with the Meet link, and the replay lands here after.
            </p>
            <div className="mx-auto mt-8 flex max-w-[34rem] flex-col gap-2 rounded-full border border-foreground/12 bg-card p-2 shadow-[0_18px_40px_-28px_rgb(0_0_0/.35)] sm:flex-row sm:items-center">
              <span className={cn(s.mono, "flex-1 px-5 py-3 text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground sm:text-left")}>
                No card · No fee · Just show up
              </span>
              <Link href="/signup?next=%2Fworkshops" className={cn(PILL, s.pinkBtn, "justify-center")}>
                Create a free account
              </Link>
            </div>
            <p className="mt-3 text-[13px] text-muted-foreground">
              Already on Outlly?{" "}
              <Link href="/login?next=%2Fworkshops" className={cn("rounded font-semibold text-foreground underline-offset-4 hover:underline", FOCUS)}>
                Log in
              </Link>{" "}
              and pick a session below.
            </p>
          </div>
        </Shell>
      </section>

      {/* Upcoming: pastel card rail with arrows below. */}
      <section id="upcoming" aria-labelledby="upcoming-title" className="scroll-mt-28 pb-14 sm:pb-20">
        <Shell>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="upcoming-title" className={cn(s.serif, "text-[clamp(1.9rem,4vw,2.75rem)] leading-tight")}>
              Pick your next <span className={cn(s.chunky, "text-[0.95em]")}>session</span>
            </h2>
            {upcoming.length > 0 && (
              <p className={cn(s.mono, "text-[12px] uppercase tracking-[0.16em] text-muted-foreground")}>
                {upcoming.length} on the calendar
              </p>
            )}
          </div>
        </Shell>

        {upcoming.length ? (
          <div className="mt-6 sm:mt-8">
            <Carousel label="Upcoming sessions">
              {upcoming.map((w, i) => (
                <li key={w.id}>
                  <WorkshopCard w={w} index={i} />
                </li>
              ))}
            </Carousel>
          </div>
        ) : (
          <Shell>
            <div className={cn("mt-8 rounded-[1.6rem] border border-foreground/10 p-8 text-center sm:p-12", s.tint, s.sun)}>
              <p className={cn(s.chunky, "text-2xl")}>Nothing on the calendar yet</p>
              <p className="mt-2 text-[15px] text-foreground/80">Follow @outlly or check back Friday.</p>
            </div>
          </Shell>
        )}
      </section>

      <Strip items={STRIP_B} say="Making creator growth simple and fun: hooks, captions, batching, analytics." />

      {/* How it works: three paper cards with sticker numbers. */}
      <section id="how" aria-labelledby="how-title" className="scroll-mt-28 py-14 sm:py-20">
        <Shell>
          <h2 id="how-title" className={cn(s.serif, "text-[clamp(1.9rem,4vw,2.75rem)] leading-tight")}>
            How it <span className={s.chunky}>works</span>
          </h2>
          <ol className="mt-8 grid gap-5 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="relative rounded-[1.6rem] border border-foreground/10 bg-card p-6 pt-8 shadow-[0_18px_40px_-30px_rgb(0_0_0/.3)]">
                <span className={cn(s.tag, [s.sun, s.pink, s.sky][i], "absolute -top-3.5 left-6", i % 2 ? "rotate-2" : "-rotate-2")} aria-hidden="true">
                  Step {i + 1}
                </span>
                <step.icon size={24} aria-hidden="true" className="text-foreground/70" />
                <h3 className={cn(s.chunky, "mt-4 text-[1.35rem] leading-tight")}>
                  <span className="sr-only">Step {i + 1}: </span>
                  {step.title}
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </Shell>
      </section>

      {/* Charcoal band: replay thumbnails, then the giant mixed-type wordmark. */}
      <section aria-labelledby="past-title" className={cn(s.band, "pt-14 sm:pt-20")}>
        <Shell>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="past-title" className={cn(s.serif, "text-[clamp(1.9rem,4vw,2.75rem)] leading-tight")}>
              Watch the <span className={s.chunky}>replays</span>
            </h2>
            <p className={cn(s.mono, "text-[12px] uppercase tracking-[0.16em] text-white/60")}>Free, no account needed</p>
          </div>

          {replays.length ? (
            <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {replays.map((w) => {
                const id = youtubeId(w.recordingUrl ?? "");
                return (
                  <li key={w.id}>
                    <a href={w.recordingUrl} target="_blank" rel="noopener noreferrer" className={cn(s.thumbLink, "group block rounded-[1.1rem]", FOCUS)}>
                      <div className={s.thumb}>
                        {id && <Image src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" width={480} height={360} unoptimized />}
                        <span className={s.play} aria-hidden="true">
                          <span>
                            <Play size={20} fill="currentColor" />
                          </span>
                        </span>
                      </div>
                      <p className="mt-3 text-[16px] font-bold leading-snug">{w.title}</p>
                      <p className={cn(s.mono, "mt-1 text-[11px] uppercase tracking-[0.14em] text-white/60")}>
                        {fmtWhen(w.startsAt, w.endsAt, w.timezone).day}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </p>
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-6 max-w-md text-[15px] leading-relaxed text-white/70">Recordings land here after each session. The first one is on its way.</p>
          )}

          {replays.length > 0 && (
            <ul className="mt-8 flex flex-wrap gap-2">
              {replays.map((w) => (
                <li key={w.id}>
                  <Link href={`/workshops/${w.slug}`} className={cn(s.whiteBtn, "inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold", FOCUS)}>
                    {w.title}
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Shell>

        <Shell className="mt-16 overflow-hidden border-t border-white/10 pt-10 pb-8 sm:mt-24">
          <p aria-hidden="true" className="whitespace-nowrap text-[clamp(1.5rem,7.4vw,7rem)] leading-[0.95] tracking-tight">
            <span className={s.chunky}>creator </span>
            <span className={cn(pixelFont.className, s.pixel)}>work</span>
            <span className={s.outline} data-text="shops">
              shops
            </span>
            <span className={s.soft}>.</span>
          </p>
          <p className="sr-only">Creator workshops</p>
          <p className={cn(s.mono, "mt-6 text-[11px] uppercase tracking-[0.18em] text-white/50")}>Outlly Creator Hub · Free, live, replays included</p>
        </Shell>
      </section>
    </div>
  );
}
