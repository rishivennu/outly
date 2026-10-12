import { Check, ChevronRight, Info } from "lucide-react";
import { AppIcon } from "@/components/brand/brands";
import { Reveal } from "./Reveal";
import { Shell } from "./bits";
import { SignupCta } from "./SignupCta";
import { PLATFORM_PITCH, COMING_LATER, type PlatformPitch } from "@/lib/marketing/content";
import { liveNow } from "@/lib/social/registry";
import type { Platform } from "@/lib/domain";

const WORD = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven"];

/** Vertical-video destinations get a phone in their bar; post-style ones get a post card. */
const VERTICAL: Platform[] = ["instagram", "youtube", "tiktok", "facebook"];

/**
 * "Supported destinations", Apple One style: the pitch on the left, and on the right a stack of
 * full-width bars, one per live destination, each dressed in that platform's own colours with its
 * real limits on it. Platforms still waiting on developer approval sit underneath as app icons.
 * The list follows the admin's platform keys, so a platform moves up the moment it goes live.
 */
export async function Platforms() {
  const live = await liveNow();
  const on = PLATFORM_PITCH.filter((p) => live.includes(p.id));
  const soon = PLATFORM_PITCH.filter((p) => !live.includes(p.id));
  const count = WORD[on.length] ?? String(on.length);

  return (
    <section id="platforms" className="scroll-mt-24 py-20 sm:py-28" aria-labelledby="platforms-title">
      <Shell>
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
          <Reveal className="lg:sticky lg:top-28">
            <div className="flex -space-x-2" aria-hidden="true">
              {on.map((p) => (
                <AppIcon key={p.id} brand={p.id} size={44} className="ring-[3px] ring-background" />
              ))}
            </div>
            <p className="eyebrow mt-6">Supported destinations</p>
            <h2 id="platforms-title" className="display mt-3 text-balance text-[clamp(2.3rem,5.4vw,3.9rem)]">
              {count} places, <span className="accent-serif energy-text">properly</span> supported.
            </h2>
            <p className="mt-5 max-w-md text-pretty text-[17px] leading-relaxed text-muted-foreground sm:text-lg">
              Each destination gets its own fields, its own limits and its own status. {on.length === 1 ? "This is the only one" : `These are the ${on.length}`} Outlly publishes to today.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2">
              <SignupCta className="ap-btn" />
              <a href="#compare" className="ap-link">
                Compare tools <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          </Reveal>

          <div className="min-w-0">
            <ol className="flex flex-col gap-3" aria-label="Live destinations">
              {on.map((p, i) => (
                <li key={p.id} className="min-w-0">
                  <Reveal delay={i * 0.06}>
                    <ServiceBar p={p} />
                  </Reveal>
                </li>
              ))}
            </ol>

            {soon.length > 0 && (
              <Reveal delay={0.1}>
                <div className="ap-canvas mt-3 rounded-[28px] p-5 sm:p-6">
                  <p className="text-[15px] font-semibold">Coming next</p>
                  <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4" aria-label="Platforms coming next">
                    {soon.map((p) => (
                      <li key={p.id} className="flex min-w-0 items-center gap-2.5">
                        <AppIcon brand={p.id} size={36} />
                        <span className="min-w-0 leading-tight">
                          <span className="block truncate text-[13.5px] font-semibold">{p.name}</span>
                          <span className="block truncate text-[12px] text-muted-foreground">{p.format}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 text-[13.5px] leading-relaxed text-muted-foreground">{COMING_LATER}</p>
                </div>
              </Reveal>
            )}
          </div>
        </div>
      </Shell>
    </section>
  );
}

/** One live destination as a full-width bar in the platform's colours, with a small picture of the format on the right. */
function ServiceBar({ p }: { p: PlatformPitch }) {
  return (
    <article className={`pf-bar pf-bar-${p.id}`}>
      <div className="relative z-[1] min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <AppIcon brand={p.id} size={48} className="pf-bar-icon" />
          <div className="min-w-0">
            <h3 className="text-[1.35rem] font-semibold leading-tight tracking-[-0.02em]">
              {p.name} <span className="font-normal opacity-80">{p.format}</span>
            </h3>
            <p className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-semibold">
              <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" /> Live
            </p>
          </div>
        </div>
        <p className="mt-3.5 max-w-[46ch] text-[15px] leading-relaxed opacity-90">{p.blurb}</p>
        <ul className="mt-3.5 flex flex-wrap gap-1.5" aria-label={`${p.name} limits`}>
          {p.specs.map((s) => (
            <li key={s} className="pf-bar-chip">{s}</li>
          ))}
        </ul>
        <p className="mt-3.5 flex max-w-[52ch] gap-2 text-[13px] leading-relaxed opacity-85">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{p.needs}</span>
        </p>
      </div>
      <FormatArt p={p.id} />
    </article>
  );
}

/** Decorative: a phone with a vertical clip, or a post card, in the corner of the bar. */
function FormatArt({ p }: { p: Platform }) {
  if (VERTICAL.includes(p))
    return (
      <span className="pf-art-phone" aria-hidden="true">
        <span className="pf-art-screen">
          <span className="pf-art-rail"><i /><i /><i /></span>
          <span className="pf-art-lines"><i /><i /></span>
        </span>
      </span>
    );
  return (
    <span className="pf-art-post" aria-hidden="true">
      <span className="flex items-center gap-1.5"><i className="pf-art-av" /><i className="pf-art-l w-12" /></span>
      <i className="pf-art-l mt-2 w-full" />
      <i className="pf-art-l mt-1 w-3/4" />
      <span className="pf-art-media" />
    </span>
  );
}
