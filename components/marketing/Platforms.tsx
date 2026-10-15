import { Check, ChevronRight, Info, ShieldCheck } from "lucide-react";
import { AppIcon } from "@/components/brand/brands";
import { Reveal } from "./Reveal";
import { Shell } from "./bits";
import { SignupCta } from "./SignupCta";
import { StackFx } from "./StackFx";
import { PLATFORM_PITCH, COMING_LATER, type PlatformPitch } from "@/lib/marketing/content";
import { liveNow } from "@/lib/social/registry";
import type { Platform } from "@/lib/domain";
import { cn } from "@/lib/utils";

const PERKS = ["Its own fields", "Its own limits, checked first", "Its own status and retries", "Official publishing API"];
const WORD = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven"];

/** Desktop rows of at most three, filled as evenly as possible (4 = 2+2, 5 = 3+2, 7 = 3+2+2). */
function rowSizes(n: number) {
  const rows = Math.max(1, Math.ceil(n / 3));
  const base = Math.floor(n / rows);
  return Array.from({ length: rows }, (_, r) => base + (r < n % rows ? 1 : 0));
}
/** Literal class names so Tailwind keeps them: a six-column track, split by how many share the row. */
const LG_SPAN: Record<number, string> = { 1: "lg:col-span-6", 2: "lg:col-span-3", 3: "lg:col-span-2" };

/**
 * "Supported destinations" (10-15 bento): a centred head like the demo section, then one bento.
 * Desktop: a tall summary tile on the left and the live destinations as brand-coloured tiles in
 * balanced rows. Mobile: the same tiles become a card stack; each card sticks under the nav and the
 * next one slides up over it (StackFx dims and shrinks the card being covered).
 * The list follows the admin's platform keys, so a platform moves up the moment it goes live.
 */
export async function Platforms({ showCompare = true, live: forced }: { showCompare?: boolean; live?: Platform[] } = {}) {
  const live = forced ?? (await liveNow());
  const on = PLATFORM_PITCH.filter((p) => live.includes(p.id));
  const soon = PLATFORM_PITCH.filter((p) => !live.includes(p.id));
  const n = on.length;
  const count = WORD[n] ?? String(n);
  const spans = rowSizes(n).flatMap((k) => Array.from({ length: k }, () => LG_SPAN[k]));

  return (
    <section id="platforms" className="scroll-mt-24 py-20 sm:py-28" aria-labelledby="platforms-title">
      <Shell>
        <Reveal y={0} className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Supported destinations</p>
          <h2 id="platforms-title" className="display mt-5 text-balance text-[clamp(2.1rem,5.4vw,3.6rem)]">
            {count} places, <span className="accent-serif energy-text">properly</span> supported.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-[17px] leading-relaxed text-muted-foreground sm:text-lg">
            Each destination gets its own fields, its own limits and its own status. {n === 1 ? "This is the only one" : `These are the ${n}`} Outlly publishes to today.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-3 sm:mt-14 xl:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
          <Reveal className="min-w-0">
            <Summary on={on} soonCount={soon.length} showCompare={showCompare} />
          </Reveal>

          <ol id="pf-stack" className="pf-stack grid min-w-0 gap-3 md:grid-cols-6" aria-label="Live destinations">
            {on.map((p, i) => (
              <li key={p.id} className={cn("pf-slot min-w-0 md:col-span-3", n % 2 === 1 && i === n - 1 && "md:col-span-6", spans[i])}>
                <Tile p={p} i={i} n={n} />
              </li>
            ))}
          </ol>
        </div>

        {soon.length > 0 && (
          <Reveal delay={0.08}>
            <div className="ap-canvas mt-3 flex flex-col gap-4 rounded-[28px] p-5 sm:p-6 lg:flex-row lg:items-center lg:gap-8">
              <p className="shrink-0 text-[15px] font-semibold">Coming next</p>
              <ul className="grid grid-cols-2 gap-x-3 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-6" aria-label="Platforms coming next">
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
              <p className="text-[13.5px] leading-relaxed text-muted-foreground lg:ml-auto lg:max-w-[42ch]">{COMING_LATER}</p>
            </div>
          </Reveal>
        )}
      </Shell>
      <StackFx id="pf-stack" />
    </section>
  );
}

/** The left tile: how many are live, their icons, and the way in. */
function Summary({ on, soonCount, showCompare }: { on: PlatformPitch[]; soonCount: number; showCompare: boolean }) {
  const total = on.length + soonCount;
  return (
    <div className="pf-summary flex h-full flex-col rounded-[28px] bg-card p-6 hairline sm:p-7 md:flex-row md:items-center md:gap-8 xl:flex-col xl:items-stretch xl:gap-0">
      <div className="shrink-0">
        <p className="text-[13px] font-semibold text-muted-foreground">Live today</p>
        <p className="mt-2 flex items-baseline gap-2">
          <span className="display text-[clamp(4rem,9vw,6rem)] leading-[0.9] tabular">{on.length}</span>
          <span className="text-[15px] font-medium text-muted-foreground tabular">of {total}</span>
        </p>
      </div>
      <div className="min-w-0">
        <div className="mt-5 flex -space-x-2 md:mt-0 xl:mt-5" aria-hidden="true">
          {on.map((p) => (
            <AppIcon key={p.id} brand={p.id} size={40} className="ring-[3px] ring-card" />
          ))}
        </div>
        <p className="mt-5 max-w-[30ch] text-[14.5px] leading-relaxed text-muted-foreground">
          One upload, drafted in each platform&apos;s own shape.{" "}
          {soonCount > 0 ? soonCount === 1 ? "One more switches on as soon as its developer app is approved." : `${WORD[soonCount] ?? soonCount} more switch on as their developer apps are approved.` : "Every platform we build for is live."}
        </p>
      </div>
      <ul className="mt-6 hidden flex-col gap-2.5 border-t border-border/60 pt-5 xl:flex" aria-label="Every destination gets">
        {PERKS.map((t) => (
          <li key={t} className="flex items-center gap-2.5 text-[14px] font-medium">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-lime/25 text-lime-ink"><Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" /></span>
            {t}
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 md:ml-auto md:mt-0 md:shrink-0 xl:ml-0 xl:mt-auto xl:pt-6">
        <SignupCta className="ap-btn" />
        {showCompare && (
          <a href="#compare" className="ap-link">
            Compare tools <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  );
}

/** One live destination in its own colours. On mobile it is a card in the stack. */
function Tile({ p, i, n }: { p: PlatformPitch; i: number; n: number }) {
  return (
    <article className={`pf-tile pf-bar-${p.id}`} aria-labelledby={`pf-${p.id}`}>
      <div className="flex items-center justify-between gap-3">
        <AppIcon brand={p.id} size={44} className="pf-bar-icon" />
        <span className="flex items-center gap-2">
          <span className="pf-count tabular md:hidden" aria-hidden="true">{String(i + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}</span>
          <span className="pf-live"><Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" /> Live</span>
        </span>
      </div>
      <h3 id={`pf-${p.id}`} className="mt-5 text-[1.3rem] font-semibold leading-tight tracking-[-0.02em]">
        {p.name} <span className="font-normal opacity-80">{p.format}</span>
      </h3>
      <p className="mt-2 text-[14.5px] leading-relaxed opacity-90">{p.blurb}</p>
      <ul className="mt-auto flex flex-wrap gap-1.5 pt-5" aria-label={`${p.name} limits`}>
        <li className="pf-bar-chip pf-chip-api"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Official API</li>
        {p.specs.map((s) => (
          <li key={s} className="pf-bar-chip">{s}</li>
        ))}
      </ul>
      <p className="mt-3 flex gap-2 text-[12.5px] leading-snug opacity-85">
        <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{p.needs}</span>
      </p>
    </article>
  );
}
