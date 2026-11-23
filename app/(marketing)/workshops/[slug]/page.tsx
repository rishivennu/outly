import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft, PlayCircle } from "lucide-react";
import { Shell } from "@/components/marketing/bits";
import { Sparkle, Star } from "@/components/workshops/Doodles";
import { RegisterCard } from "@/components/workshops/RegisterCard";
import s from "@/components/workshops/workshops.module.css";
import { getCurrentUser } from "@/lib/auth";
import { pageOn } from "@/lib/landing";
import { getConfig } from "@/lib/settings";
import { LEVEL_LABEL, fmtWhen, youtubeId } from "@/lib/workshops/core";
import { eventJsonLd, jsonLdString } from "@/lib/workshops/jsonld";
import { getWorkshop, workshopUrl } from "@/lib/workshops/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

const viewer = cache(async () => {
  const u = await getCurrentUser().catch(() => null);
  return u ? { id: u.id, email: u.email } : null;
});
const enabled = cache(async () => pageOn(await getConfig("landing").catch(() => null), "workshops")); // R1310 admin page switch
const load = cache(async (slug: string) => ((await enabled()) ? getWorkshop(slug, await viewer()) : null));

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { slug } = await props.params;
  const w = await load(slug);
  if (!w) notFound();
  const description = w.summary || `A free live workshop on Google Meet, hosted by ${w.host || "the Outlly team"}.`;
  return {
    title: w.title,
    description,
    alternates: { canonical: `/workshops/${w.slug}` },
    openGraph: { type: "website", title: `${w.title} · Outlly workshops`, description, url: `/workshops/${w.slug}`, ...(w.coverUrl ? { images: [w.coverUrl] } : {}) },
    twitter: { card: w.coverUrl ? "summary_large_image" : "summary", title: w.title, description },
  };
}

export default async function WorkshopPage(props: Props) {
  const { slug } = await props.params;
  const [w, who] = await Promise.all([load(slug), viewer()]);
  if (!w) notFound();
  const when = fmtWhen(w.startsAt, w.endsAt, w.timezone);
  const url = workshopUrl(w.slug);
  const paragraphs = w.description.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);
  const yt = w.recordingUrl ? youtubeId(w.recordingUrl) : null;
  const zone = when.time.split(" ").pop() || "IST";
  const words = w.title.trim().split(/\s+/);
  const tail = words.pop() ?? "";
  const head = words.join(" ");
  const meta = [
    { k: "When", v: when.day },
    { k: "Time", v: when.time },
    { k: "Length", v: when.dur },
  ];

  return (
    <div className={cn(s.page, "overflow-x-clip")}>
      <section className="py-10 sm:py-16">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(eventJsonLd(w, url)) }} />
        <Shell>
          <Link href="/workshops" className={cn(s.mono, "inline-flex min-h-10 items-center gap-2 rounded-full pr-3 text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground touch:min-h-11", FOCUS)}>
            <ArrowLeft size={16} aria-hidden="true" />
            All workshops
          </Link>

          <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-14">
            <article className="relative min-w-0">
              <Star className="right-[2%] top-[-2.5rem] hidden w-12 rotate-12 lg:block" />
              <Sparkle className="right-[16%] top-[3rem] hidden w-7 -rotate-6 lg:block" color="hsl(44 96% 56%)" />

              <ul aria-label="Session type" className="flex flex-wrap gap-2">
                <li className={cn(s.tag, s.pink, "-rotate-2")}>{LEVEL_LABEL[w.level]}</li>
                <li className={cn(s.tag, s.sun, "rotate-1")}>Free</li>
                {w.live && (
                  <li className={cn(s.tag, "gap-2 bg-foreground text-background")}>
                    <span className="live-dot" aria-hidden="true" />
                    Live now
                  </li>
                )}
              </ul>
              <h1 className="mt-7 text-balance text-[clamp(2.4rem,5.6vw,4.4rem)] leading-[1.0] tracking-tight">
                {head && <span className={s.chunky}>{head} </span>}
                <span className={cn(s.outline, "whitespace-nowrap")} data-text={tail}>
                  {tail}
                </span>
              </h1>
              {w.summary && <p className="mt-5 max-w-2xl text-pretty text-[17px] leading-relaxed text-muted-foreground sm:text-lg">{w.summary}</p>}

              <dl className="mt-8 grid gap-4 rounded-[1.6rem] border border-foreground/10 bg-card p-5 shadow-[0_18px_40px_-30px_rgb(0_0_0/.3)] sm:grid-cols-3 sm:p-6">
                {meta.map((m) => (
                  <div key={m.k}>
                    <dt className={cn(s.mono, "text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground")}>{m.k}</dt>
                    <dd className={cn(s.chunky, "mt-1.5 text-[1.15rem] leading-tight")}>{m.v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 px-1 text-[13px] text-muted-foreground">Times shown in {zone}; your calendar converts them.</p>

              {w.host && (
                <p className={cn(s.serif, "mt-7 text-[1.35rem] leading-snug")}>
                  with <span className="font-bold">{w.host}</span>, for Outlly creators
                </p>
              )}

              {paragraphs.length > 0 && (
                <div className="mt-8 max-w-2xl space-y-4 text-[17px] leading-relaxed text-foreground/90">
                  {paragraphs.map((p, i) => (
                    <p key={i} className="whitespace-pre-line">
                      {p}
                    </p>
                  ))}
                </div>
              )}

              {w.tags.length > 0 && (
                <ul aria-label="Topics" className="mt-8 flex flex-wrap gap-2">
                  {w.tags.map((t, i) => (
                    <li key={t} className={cn(s.tag, [s.sky, s.mint, s.sun, s.pink][i % 4], "min-h-8 normal-case tracking-[0.04em]")}>
                      {t}
                    </li>
                  ))}
                </ul>
              )}

              {w.recordingUrl && (
                <div className="mt-10">
                  <h2 className={cn(s.serif, "text-[1.9rem] leading-tight")}>
                    The <span className={s.chunky}>replay</span>
                  </h2>
                  {yt ? (
                    <div className="mt-4 aspect-video overflow-hidden rounded-[1.6rem] border border-foreground/10 bg-card">
                      <iframe
                        src={`https://www.youtube-nocookie.com/embed/${yt}`}
                        title={`Replay: ${w.title}`}
                        loading="lazy"
                        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                        referrerPolicy="strict-origin-when-cross-origin"
                        allowFullScreen
                        className="h-full w-full"
                      />
                    </div>
                  ) : (
                    <a href={w.recordingUrl} target="_blank" rel="noopener noreferrer" className={cn("mt-4 inline-flex min-h-12 items-center gap-2 rounded-full px-6 text-[15px] font-bold", s.pinkBtn, FOCUS)}>
                      <PlayCircle size={18} aria-hidden="true" />
                      Watch the replay
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  )}
                </div>
              )}
            </article>

            <aside aria-label="Your seat" className="lg:sticky lg:top-28 lg:self-start">
              <RegisterCard workshop={w} signedIn={!!who} pageUrl={url} />
            </aside>
          </div>
        </Shell>
      </section>
    </div>
  );
}
