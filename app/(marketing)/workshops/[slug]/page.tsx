import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft, PlayCircle } from "lucide-react";
import { Shell } from "@/components/marketing/bits";
import { RegisterCard } from "@/components/workshops/RegisterCard";
import { getCurrentUser } from "@/lib/auth";
import { LEVEL_LABEL, fmtWhen } from "@/lib/workshops/core";
import { eventJsonLd, jsonLdString } from "@/lib/workshops/jsonld";
import { getWorkshop, workshopUrl } from "@/lib/workshops/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

const viewer = cache(async () => {
  const u = await getCurrentUser().catch(() => null);
  return u ? { id: u.id, email: u.email } : null;
});
const load = cache(async (slug: string) => getWorkshop(slug, await viewer()));

const MARKER = "relative isolate inline-block before:absolute before:-inset-x-1 before:bottom-1 before:-z-10 before:h-[0.4em] before:-rotate-1 before:rounded-sm before:bg-lime dark:before:bg-lime/35";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** watch?v=, youtu.be/, /live/, /embed/ and /shorts/ links; anything else stays a plain link. */
function youtubeId(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    const id = host === "youtu.be" ? u.pathname.slice(1) : host === "youtube.com" || host === "youtube-nocookie.com" ? u.searchParams.get("v") ?? u.pathname.match(/^\/(?:live|embed|shorts)\/([^/]+)/)?.[1] : null;
    return id && /^[\w-]{6,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

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

  return (
    <section className="py-10 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(eventJsonLd(w, url)) }} />
      <Shell>
        <Link href="/workshops" className={cn("inline-flex min-h-10 items-center gap-2 rounded-full pr-3 text-[15px] font-medium text-muted-foreground hover:text-foreground touch:min-h-11", FOCUS)}>
          <ArrowLeft size={16} aria-hidden="true" />
          All workshops
        </Link>

        <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-14">
          <article className="min-w-0">
            <p className="inline-flex -rotate-2 items-center gap-2 rounded-full border-[3px] border-foreground bg-background px-4 py-2 font-display text-xs font-extrabold uppercase tracking-[0.18em] shadow-[4px_4px_0_hsl(var(--foreground))]">
              {LEVEL_LABEL[w.level]}
              <span aria-hidden="true" className="h-1.5 w-1.5 rotate-45 bg-foreground" />
              Free
            </p>
            <h1 className="mt-7 text-balance font-display text-[clamp(2.2rem,5vw,3.8rem)] font-extrabold leading-[1.05] tracking-tight">
              {head && <>{head} </>}
              <span className={MARKER}>{tail}</span>
            </h1>
            {w.summary && <p className="mt-5 max-w-2xl text-pretty text-[17px] leading-relaxed text-muted-foreground sm:text-lg">{w.summary}</p>}

            <dl className="mt-8 grid gap-4 rounded-[1.5rem] border border-border bg-card p-5 sm:grid-cols-3 sm:p-6">
              <div>
                <dt className="text-[13px] font-medium text-muted-foreground">When</dt>
                <dd className="mt-1 font-display text-[17px] font-bold">{when.day}</dd>
              </div>
              <div>
                <dt className="text-[13px] font-medium text-muted-foreground">Time</dt>
                <dd className="mt-1 font-display text-[17px] font-bold">{when.time}</dd>
              </div>
              <div>
                <dt className="text-[13px] font-medium text-muted-foreground">Length</dt>
                <dd className="mt-1 font-display text-[17px] font-bold">{when.dur}</dd>
              </div>
            </dl>
            <p className="mt-3 px-1 text-[13px] text-muted-foreground">Times shown in {zone}; your calendar converts them.</p>

            {w.host && (
              <p className="mt-6 text-[15px]">
                Hosted by <span className="font-semibold">{w.host}</span> <span className="accent-serif text-lg">for</span> Outlly creators
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
                {w.tags.map((t) => (
                  <li key={t} className="rounded-full border border-border bg-card px-3 py-1 text-[13px] font-medium text-muted-foreground">
                    {t}
                  </li>
                ))}
              </ul>
            )}

            {w.recordingUrl && (
              <div className="mt-10">
                <h2 className="font-display text-2xl font-extrabold tracking-tight">
                  The <span className="accent-serif font-normal">replay</span>
                </h2>
                {yt ? (
                  <div className="mt-4 aspect-video overflow-hidden rounded-[1.5rem] border border-border bg-card">
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
                  <a
                    href={w.recordingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn("mt-4 inline-flex min-h-12 items-center gap-2 rounded-full bg-foreground px-6 font-display text-[15px] font-bold text-background hover:opacity-90", FOCUS)}
                  >
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
  );
}
