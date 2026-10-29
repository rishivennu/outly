import { Check, Play } from "lucide-react";
import { FinalCtaButtons } from "./FinalCtaButtons";
import { AppIcon, type Brand } from "@/components/brand/brands";
import { Shell } from "./bits";
import { Reveal } from "./Reveal";
import { FINAL_CTA } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

/**
 * Closing call, in the Apple Music layout: centred mark and headline, one phone in the middle,
 * flanked by a wall of tiles. Here the tiles are the destinations and the posts that came out of
 * that single upload. Everything below the buttons is decoration and hidden from screen readers.
 */

type Tile = { kind: "app"; brand: Brand } | { kind: "post"; label: string; bg: string; brand: Brand };

// Only the three places Outlly publishes to today (lib/marketing/content.ts rule: nothing aspirational as shipped).
const LEFT: Tile[] = [
  { kind: "post", label: "Reel", bg: "linear-gradient(150deg,#ffb36b,#f0447a 55%,#7b3cff)", brand: "instagram" },
  { kind: "app", brand: "instagram" },
  { kind: "post", label: "Post", bg: "linear-gradient(160deg,#2b2b2e,#5a5a62)", brand: "x" },
  { kind: "app", brand: "youtube" },
  { kind: "post", label: "Short", bg: "linear-gradient(160deg,#ff5f4f,#b3121a)", brand: "youtube" },
  { kind: "app", brand: "x" },
];
const RIGHT: Tile[] = [
  { kind: "app", brand: "youtube" },
  { kind: "post", label: "Post", bg: "linear-gradient(150deg,#c9f25d,#4fbf73 60%,#1f7a6a)", brand: "x" },
  { kind: "app", brand: "x" },
  { kind: "post", label: "Reel", bg: "linear-gradient(160deg,#5aa8ff,#2a4bd8)", brand: "instagram" },
  { kind: "app", brand: "instagram" },
  { kind: "post", label: "Short", bg: "linear-gradient(150deg,#ffcf8a,#ff7a59 45%,#6c3bff)", brand: "youtube" },
];

function TileView({ t, className }: { t: Tile; className?: string }) {
  if (t.kind === "app")
    return (
      <span className={cn("fc-tile grid place-items-center bg-[hsl(var(--ap-tile))]", className)}>
        <AppIcon brand={t.brand} size={56} />
      </span>
    );
  return (
    <span className={cn("fc-tile relative block overflow-hidden", className)} style={{ background: t.bg }}>
      <span className="absolute left-2.5 top-2.5"><AppIcon brand={t.brand} size={22} /></span>
      <span className="absolute inset-x-2.5 bottom-2.5 flex w-fit items-center gap-1.5 rounded-md bg-[#0b0b0d]/95 px-1.5 py-0.5 text-[12px] font-semibold text-white">
        <Play className="h-3 w-3 fill-current" />
        {t.label}
      </span>
    </span>
  );
}

/** Two columns per side; the outer column only shows on wide screens, and drops lower, Apple style. */
function Wall({ tiles, side }: { tiles: Tile[]; side: "l" | "r" }) {
  const cols = [tiles.filter((_, i) => i % 2 === 0), tiles.filter((_, i) => i % 2 === 1)];
  const [inner, outer] = side === "l" ? [cols[1], cols[0]] : [cols[0], cols[1]];
  const col = (list: Tile[], extra: string) => (
    <span className={cn("flex flex-col gap-3 sm:gap-4", extra)}>
      {list.map((t, i) => <TileView key={i} t={t} />)}
    </span>
  );
  return (
    <span className={cn("flex items-start gap-3 sm:gap-4", side === "l" ? "flex-row" : "flex-row-reverse")}>
      {col(outer, "hidden pt-24 lg:flex")}
      {col(inner, "pt-10 sm:flex")}
    </span>
  );
}

const ROW: Brand[] = ["instagram", "youtube", "x"];

const SENT: { brand: Brand; name: string; what: string }[] = [
  { brand: "instagram", name: "Instagram", what: "Reel" },
  { brand: "youtube", name: "YouTube", what: "Short" },
  { brand: "x", name: "X", what: "Post" },
];

function CtaPhone() {
  return (
    <span className="dm-phone fc-phone shrink-0">
      <span className="dm-screen block">
        <span className="dm-island" />
        <span className="flex items-center justify-between px-7 pt-[14px] text-[12px] font-semibold">
          <span>4:12</span>
          <span className="h-2.5 w-5 rounded-[3px] bg-foreground/80" />
        </span>
        <span className="block px-4 pt-7">
          <span className="block text-[11.5px] font-semibold text-[hsl(var(--ap-ink2))]">Today</span>
          <span className="mt-0.5 block font-display text-[22px] font-bold tracking-[-0.02em]">All sent.</span>
          <span className="relative mt-3 block aspect-[16/10] overflow-hidden rounded-[18px]" style={{ background: "linear-gradient(140deg,#ffcf8a,#ff7a59 45%,#6c3bff)" }}>
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-white/85 text-black backdrop-blur"><Play className="ml-0.5 h-5 w-5 fill-current" /></span>
            </span>
            <span className="absolute bottom-2 left-3 rounded-md bg-[#0b0b0d]/95 px-1.5 py-0.5 text-[12px] font-semibold text-white">desk-tour.mp4 · 0:42</span>
          </span>
          <span className="mt-3 block overflow-hidden rounded-[18px] bg-foreground/[0.05]">
            {SENT.map((s, i) => (
              <span key={s.brand} className={cn("flex items-center gap-2.5 px-3 py-2.5", i > 0 && "border-t border-foreground/[0.08]")}>
                <AppIcon brand={s.brand} size={30} />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block text-[13.5px] font-semibold">{s.name}</span>
                  <span className="block text-[12px] text-[hsl(var(--ap-ink2))]">{s.what}</span>
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11.5px] font-semibold pill-ink-ok">
                  <Check className="h-3 w-3" strokeWidth={3} />
                  Live
                </span>
              </span>
            ))}
          </span>
        </span>
      </span>
    </span>
  );
}

export function FinalCta({ beta = false }: { beta?: boolean }) {
  const m = FINAL_CTA.title.match(/^(.*?\.\s.*?\.)\s(.*)$/);
  const [first, second] = m ? [m[1], m[2]] : [FINAL_CTA.title, ""];
  return (
    <section className="pb-24 pt-10 sm:pb-32" aria-labelledby="cta-title">
      <Shell>
        <Reveal y={40}>
          <div className="ap-canvas relative overflow-hidden rounded-[2.25rem] px-6 pt-14 text-center sm:px-12 sm:pt-20">
            <Reveal stagger y={20} className="relative mx-auto flex max-w-3xl flex-col items-center">
              <AppIcon brand="outly" size={64} />
              <h2 id="cta-title" className="display mt-7 text-balance text-[clamp(2.2rem,6vw,4.25rem)]">
                {first}
                {second && (
                  <>
                    {" "}
                    <span className="block text-[hsl(var(--ap-ink2))]">{second}</span>
                  </>
                )}
              </h2>
              <p className="mt-5 max-w-xl text-pretty text-[17px] leading-relaxed text-[hsl(var(--ap-ink2))] sm:text-lg">{FINAL_CTA.body}</p>
              <FinalCtaButtons />
              <p className="mt-3 text-[13px] text-[hsl(var(--ap-ink2))]">{beta ? "Free while in beta. No card needed." : "Start free. No card needed."}</p>
            </Reveal>

            {/* Phones: the destinations as one row that always fits (the side walls need 768px). */}
            <div aria-hidden="true" className="mx-auto mt-10 flex max-w-full justify-center gap-2 md:hidden">
              {ROW.map((b) => <AppIcon key={b} brand={b} size={38} />)}
            </div>

            <div aria-hidden="true" className="fc-stage relative mx-auto mt-8 md:mt-12 flex h-[400px] max-w-[1000px] items-start justify-center gap-3 sm:mt-14 sm:h-[460px] sm:gap-4">
              <Wall tiles={LEFT} side="l" />
              <CtaPhone />
              <Wall tiles={RIGHT} side="r" />
            </div>
          </div>
        </Reveal>
      </Shell>
    </section>
  );
}
