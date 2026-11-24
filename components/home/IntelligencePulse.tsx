import Link from "next/link";
import { ArrowUpRight, BrainCircuit, Scissors } from "lucide-react";
import { LEVEL_LABEL } from "@/lib/intelligence/profile-core";
import { clipperLine, platformName, sampleWords, type IntelligencePulse as Pulse } from "@/lib/intelligence/pulse-core";

/**
 * R1325 (Phase 7): Home "Intelligence pulse". Per platform the baseline the engine stands behind (the number, its
 * usual range and the sample it came from), one personal recommendation, and the Shorts clipper's queue. Every
 * number names its sample; a platform with nothing measured says so instead of showing 0.
 */
const num = (n: number) => Math.round(n).toLocaleString("en");

export function IntelligencePulseCard({ p }: { p: Pulse }) {
  const platforms = p.platforms.slice(0, 4);
  const more = p.platforms.length - platforms.length;
  const clipper = clipperLine(p.clipper);
  return (
    <section aria-labelledby="intel-pulse-h" className="glass min-w-0 rounded-[32px] p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="intel-pulse-h" className="eyebrow flex items-center gap-2"><BrainCircuit className="h-3.5 w-3.5" aria-hidden="true" /> Intelligence pulse</h2>
        <Link href="/intelligence#intel-baselines" className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-medium text-foreground/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Your baselines <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
      {platforms.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing measured yet. Baselines appear once a published post is a day old and has numbers.</p>
      ) : (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {platforms.map((x) => (
            <li key={x.platform} className="rounded-2xl bg-secondary/60 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium">{platformName(x.platform)}{x.top ? <span className="text-muted-foreground"> · {x.top.format}</span> : null}</p>
                <span className="text-xs font-medium text-muted-foreground">{LEVEL_LABEL[x.level]}</span>
              </div>
              {x.top ? (
                <>
                  <p className="display mt-1.5 text-3xl leading-none tabular-nums">~{num(x.top.predicted)} <span className="text-sm font-medium text-muted-foreground">views</span></p>
                  <p className="mt-1.5 text-[13px] text-muted-foreground tabular-nums">
                    usually {num(x.top.low)} to {num(x.top.high)} ·{" "}
                    {sampleWords(x.top) ?? "sample unknown"}
                  </p>
                </>
              ) : (
                <p className="mt-1.5 text-sm text-muted-foreground">No measured post yet, so no number.</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <p className="mt-2 text-[13px] text-muted-foreground">
          And {more} more platform{more === 1 ? "" : "s"} <Link href="/intelligence#intel-baselines" className="underline underline-offset-2 hover:text-foreground">on your baselines page</Link>.
        </p>
      )}
      {p.recommendation && (
        <Link href="/intelligence#intel-personal" aria-label={`Made for you: ${p.recommendation.title}. Open your recommendations`} className="mt-3 block rounded-2xl bg-[hsl(var(--lime)/0.16)] p-4 transition-colors hover:bg-[hsl(var(--lime)/0.24)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <p className="text-xs font-medium text-foreground/70">Made for you · {platformName(p.recommendation.platform)} · {p.recommendation.confidence} confidence</p>
          <p className="mt-1 text-sm font-medium">{p.recommendation.title}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-foreground/75">{p.recommendation.why}</p>
        </Link>
      )}
      {clipper && (
        <Link href="/clipper" className="mt-3 flex items-start gap-2 rounded-2xl bg-secondary/60 p-4 text-[13px] leading-relaxed text-muted-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Scissors className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span><span className="font-medium text-foreground">Shorts clipper</span> · {clipper}</span>
        </Link>
      )}
    </section>
  );
}
