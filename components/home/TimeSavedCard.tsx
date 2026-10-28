import { Hourglass } from "lucide-react";
import type { SavedTime } from "@/lib/retention/time-saved";
import { OUTLLY_MIN_PER_VIDEO, TIME_DEFAULTS, minutesLabel } from "@/lib/marketing/time-saved";

/**
 * Home "Time saved" (1038): how long the creator's real posts would have taken by hand, minus the time they
 * took in Outlly. Same assumptions as the landing calculator, written out under the number.
 */
export function TimeSavedCard({ t }: { t: SavedTime }) {
  if (t.posts === 0) return null;
  const hours = Math.round((t.totalMin / 60) * 10) / 10;
  return (
    <section aria-labelledby="saved-h" className="glass min-w-0 rounded-[32px] p-5 sm:p-6">
      <h2 id="saved-h" className="eyebrow flex items-center gap-2"><Hourglass className="h-3.5 w-3.5" aria-hidden="true" /> Time saved</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="rounded-2xl bg-[hsl(var(--lime)/0.16)] p-4 sm:p-5">
          <p className="text-xs font-medium text-foreground/70">Last 7 days</p>
          <p className="display mt-1.5 text-[clamp(2rem,6vw,2.6rem)] leading-none tabular-nums">{minutesLabel(t.weekMin)}</p>
          <p className="mt-1.5 text-sm text-foreground/75">
            {t.weekPosts === 0 ? "Nothing went out this week yet." : `across ${t.weekPosts} ${t.weekPosts === 1 ? "post" : "posts"} you didn't have to post by hand`}
          </p>
        </div>
        <div className="rounded-2xl bg-secondary/60 p-4 sm:p-5">
          <p className="text-xs font-medium text-muted-foreground">Since you joined</p>
          <p className="display mt-1.5 text-3xl leading-none tabular-nums">{hours >= 1 ? `${hours} h` : minutesLabel(t.totalMin)}</p>
          <p className="mt-1.5 text-sm text-muted-foreground">{t.posts} {t.posts === 1 ? "post" : "posts"} published</p>
        </div>
      </div>
      <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
        Estimate: {TIME_DEFAULTS.byHand} min per platform by hand, {OUTLLY_MIN_PER_VIDEO} min per video in Outlly.
      </p>
    </section>
  );
}
