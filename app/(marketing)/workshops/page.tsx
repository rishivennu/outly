import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, CalendarCheck, MousePointerClick, PlayCircle } from "lucide-react";
import { Shell } from "@/components/marketing/bits";
import { WorkshopCard } from "@/components/workshops/WorkshopCard";
import s from "@/components/workshops/workshops.module.css";
import { fmtWhen, type WorkshopView } from "@/lib/workshops/core";
import { jsonLdString, listJsonLd } from "@/lib/workshops/jsonld";
import { listPublicWorkshops } from "@/lib/workshops/server";
import { env } from "@/lib/env";
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
const STICKER = "inline-flex items-center rounded-full border-[3px] border-foreground bg-background px-4 py-2 font-display text-xs font-extrabold uppercase tracking-[0.18em] text-foreground shadow-[4px_4px_0_hsl(var(--foreground))]";
const MARKER = "relative isolate inline-block before:absolute before:-inset-x-1 before:bottom-1 before:-z-10 before:h-[0.45em] before:-rotate-1 before:rounded-sm before:bg-lime dark:before:bg-lime/35";
const MARQUEE = ["Free workshops", "Live on Meet", "Replays", "Q&A"];

const STEPS = [
  { icon: MousePointerClick, title: "Register in one click", body: "Pick a session and save your seat with your Outlly account." },
  { icon: CalendarCheck, title: "The invite lands in your calendar", body: "A Google Calendar invite with the Meet link arrives by email. Your calendar handles the time zone." },
  { icon: PlayCircle, title: "Missed it? Watch the replay", body: "Recordings go up on this page after each session, free to watch." },
];

async function load(): Promise<{ upcoming: WorkshopView[]; past: WorkshopView[] }> {
  try {
    return await listPublicWorkshops();
  } catch (e) {
    console.warn("[workshops] list unavailable:", e instanceof Error ? e.message : e);
    return { upcoming: [], past: [] };
  }
}

function Marquee() {
  const run = (hidden: boolean) => (
    <div className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {[...MARQUEE, ...MARQUEE].map((t, i) => (
        <span key={i} className="flex items-center gap-6 pr-6 font-display text-lg font-extrabold uppercase tracking-[0.08em] sm:text-2xl">
          {t}
          <span aria-hidden="true" className="text-lime dark:text-[hsl(84_85%_24%)]">✦</span>
        </span>
      ))}
    </div>
  );
  return (
    <div className={cn(s.marquee, "border-y-[3px] border-foreground bg-foreground py-3 text-background")}>
      <p className="sr-only">Free workshops, live on Google Meet, with replays and Q&amp;A.</p>
      <div className={s.track} aria-hidden="true">
        {run(true)}
        {run(true)}
      </div>
    </div>
  );
}

export default async function WorkshopsPage() {
  const { upcoming, past } = await load();
  const replays = past.filter((w) => w.recordingUrl);
  const base = env.APP_URL.replace(/\/+$/, "");

  return (
    <>
      {upcoming.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(listJsonLd(upcoming, base)) }} />}

      <section className="py-12 sm:py-20">
        <Shell>
          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div>
              <p className="inline-flex min-h-8 items-center gap-2 rounded-full border border-border bg-card px-3.5 text-[13px] font-medium leading-none text-muted-foreground">
                <span aria-hidden="true" className="h-1.5 w-1.5 rotate-45 bg-lime" />
                Creator Hub · Free workshops
              </p>
              <h1 className="mt-6 max-w-[15ch] text-balance font-display text-[clamp(2.6rem,6vw,4.6rem)] font-extrabold leading-[1.04] tracking-tight">
                Learn <span className="accent-serif font-normal">live</span>, <span className={MARKER}>grow</span> your audience,{" "}
                <span className="mt-2 inline-block rounded-full bg-foreground px-[0.4em] pb-[0.08em] text-background">ship faster.</span>
              </h1>
              <p className="mt-6 max-w-xl text-pretty text-[17px] leading-relaxed text-muted-foreground sm:text-lg">{LEAD}</p>

              <ul aria-label="Highlights" className="mt-8 flex flex-wrap gap-3 lg:hidden">
                <li className={cn(STICKER, "-rotate-3")}>Live on Google Meet</li>
                <li className={cn(STICKER, "rotate-2")}>Free, always</li>
                <li className={cn(STICKER, "-rotate-1")}>Replay included</li>
              </ul>

              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#upcoming" className={cn("inline-flex min-h-12 items-center gap-2 rounded-full bg-foreground px-6 font-display text-[15px] font-bold text-background transition hover:opacity-90", FOCUS)}>
                  See upcoming sessions
                  <ArrowDown size={18} aria-hidden="true" />
                </a>
                <a href="#how" className={cn("inline-flex min-h-12 items-center rounded-full border-2 border-foreground/20 px-6 font-display text-[15px] font-bold text-foreground transition hover:border-foreground/50", FOCUS)}>
                  How workshops work
                </a>
              </div>
            </div>

            <ul aria-label="Highlights" className="relative hidden h-[22rem] lg:block">
              <li className={cn(STICKER, "absolute left-[8%] top-[10%] -rotate-6 px-6 py-3 text-sm")}>Live on Google Meet</li>
              <li className={cn(STICKER, "absolute right-[4%] top-[42%] rotate-[8deg] bg-lime px-6 py-3 text-sm text-lime-foreground")}>Free, always</li>
              <li className={cn(STICKER, "absolute bottom-[8%] left-[18%] -rotate-3 bg-[hsl(330_90%_92%)] px-6 py-3 text-sm dark:bg-[hsl(330_45%_24%)]")}>Replay included</li>
            </ul>
          </div>
        </Shell>
      </section>

      <Marquee />

      <section id="upcoming" aria-labelledby="upcoming-title" className="scroll-mt-28 py-16 sm:py-24">
        <Shell>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="upcoming-title" className="font-display text-[clamp(2rem,4vw,3rem)] font-extrabold leading-tight tracking-tight">
              Upcoming <span className="accent-serif font-normal">sessions</span>
            </h2>
            {upcoming.length > 0 && (
              <p className="text-[15px] text-muted-foreground">
                {upcoming.length} {upcoming.length === 1 ? "session" : "sessions"} on the calendar
              </p>
            )}
          </div>

          {upcoming.length ? (
            <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {upcoming.map((w, i) => (
                <li key={w.id}>
                  <WorkshopCard w={w} index={i} />
                </li>
              ))}
            </ul>
          ) : (
            <div className={cn("mt-10 rounded-[1.5rem] border border-foreground/10 p-8 text-center sm:p-12", s.tint, s.sun)}>
              <p className="font-display text-2xl font-extrabold tracking-tight">Nothing on the calendar yet</p>
              <p className="mt-2 text-[15px] text-foreground/80">Follow @outlly or check back Friday.</p>
            </div>
          )}
        </Shell>
      </section>

      <section id="how" aria-labelledby="how-title" className="scroll-mt-28 bg-[hsl(152_42%_13%)] py-16 text-[hsl(48_40%_96%)] sm:py-24">
        <Shell>
          <h2 id="how-title" className="font-display text-[clamp(2rem,4vw,3rem)] font-extrabold leading-tight tracking-tight">
            How it <span className="accent-serif font-normal">works</span>
          </h2>
          <ol className="mt-10 grid gap-5 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="rounded-[1.5rem] border border-white/15 bg-white/[0.06] p-6">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-lime font-display text-base font-extrabold text-lime-foreground" aria-hidden="true">
                    {i + 1}
                  </span>
                  <step.icon size={22} aria-hidden="true" className="opacity-80" />
                </div>
                <h3 className="mt-5 font-display text-xl font-extrabold tracking-tight">
                  <span className="sr-only">Step {i + 1}: </span>
                  {step.title}
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-white/80">{step.body}</p>
              </li>
            ))}
          </ol>
        </Shell>
      </section>

      {replays.length > 0 && (
        <section aria-labelledby="past-title" className="py-16 sm:py-24">
          <Shell>
            <h2 id="past-title" className="font-display text-[clamp(1.75rem,3.4vw,2.5rem)] font-extrabold leading-tight tracking-tight">
              Past sessions, <span className="accent-serif font-normal">on replay</span>
            </h2>
            <ul className="mt-8 divide-y divide-border rounded-[1.5rem] border border-border bg-card">
              {replays.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 sm:px-6">
                  <div className="min-w-0 flex-1">
                    <Link href={`/workshops/${w.slug}`} className={cn("rounded font-display text-[17px] font-bold hover:underline", FOCUS)}>
                      {w.title}
                    </Link>
                    <p className="text-[13px] text-muted-foreground">{fmtWhen(w.startsAt, w.endsAt, w.timezone).day}</p>
                  </div>
                  <a
                    href={w.recordingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn("inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-foreground/15 px-4 text-[14px] font-semibold hover:border-foreground/40", FOCUS)}
                  >
                    <PlayCircle size={16} aria-hidden="true" />
                    Watch replay
                    <span className="sr-only">: {w.title} (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          </Shell>
        </section>
      )}
    </>
  );
}
