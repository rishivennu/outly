/**
 * Perf: what Home shows while its numbers stream in (app/(studio)/home/page.tsx, PULSE_MS). It repeats PulseHome's
 * own boxes with the same classes (header, platform tabs, range switch, the four number cards, the chart and the
 * top posts card), so the real dashboard lands in the same place and nothing above or beside it moves. The greeting,
 * the next post and the card labels are already known, so they are real text, not bars. What only the data can tell
 * (how many top posts, the per-platform cards) sits at the end of the page, where a different length moves nothing.
 */
const LABELS = ["Views", "Interactions", "Engagement", "Posts sent"];

const Bar = ({ className }: { className: string }) => <span aria-hidden="true" className={`skeleton block rounded-lg ${className}`} />;

export function PulseSkeleton({ firstName, nextPost }: { firstName: string; nextPost: { when: string } | null }) {
  return (
    <div className="page-frame pb-16 pt-6 lg:pt-8" aria-busy="true" aria-label="Loading your numbers" data-pulse-skeleton="">
      <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="font-display truncate text-[24px] font-bold tracking-tight min-[400px]:text-[26px] sm:text-[32px]">Welcome back, {firstName || "there"}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[14px] text-muted-foreground sm:mt-1">
            <span className="pulse-status"><span className="pulse-status-dot" aria-hidden="true" />{nextPost ? `Next post ${nextPost.when}` : "Nothing booked yet"}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Bar className="h-11 w-[132px] rounded-2xl" />
        </div>
      </header>

      <div className="mt-4 flex flex-col-reverse gap-2 border-b border-border/70 sm:mt-6 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="relative -mb-px flex min-w-0 gap-1">
          <span className="flex h-11 shrink-0 items-center px-3.5 text-[14px] font-medium">All platforms</span>
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-start sm:pb-3">
          <span className="pulse-seg relative">
            {[7, 30, 90].map((r) => (
              <span key={r} className="relative z-[1] grid h-11 min-w-[48px] place-items-center rounded-[12px] px-2.5 text-[14px] font-semibold tabular-nums text-muted-foreground sm:min-w-[52px] sm:px-3">{r}D</span>
            ))}
          </span>
          <Bar className="h-4 w-36" />
        </div>
      </div>

      <section aria-hidden="true" className="mt-4 grid grid-cols-2 gap-3 sm:mt-5 lg:grid-cols-4 lg:gap-4">
        {LABELS.map((label) => (
          <article key={label} className="pulse-card flex min-w-0 flex-col gap-3 p-4 sm:p-5">
            <p className="flex items-center gap-2.5 text-[14px] font-medium text-muted-foreground">
              <span className="pulse-ico" />
              <span className="truncate">{label}</span>
            </p>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
              <div className="min-w-0">
                <span className="font-display block text-[26px] font-bold tracking-tight tabular-nums min-[400px]:text-[30px] sm:text-[32px]">
                  <span className="inline-flex leading-none"><span className="skeleton inline-block h-[1em] w-[2.4em] rounded-md" /></span>
                </span>
                <div className="mt-2 whitespace-nowrap"><span className="pulse-delta is-flat w-16">{"\u00a0"}</span></div>
              </div>
              <div className="w-full shrink-0 sm:w-[44%] sm:max-w-[120px]">
                <Bar className="h-10 w-full rounded-xl" />
              </div>
            </div>
          </article>
        ))}
      </section>

      <div aria-hidden="true" className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <section className="pulse-card min-w-0 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[16px] font-semibold tracking-tight">Views over time</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">All platforms, compared with the 7 days before</p>
            </div>
          </div>
          <div className="relative mt-4">
            <Bar className="h-[240px] w-full rounded-xl" />
          </div>
        </section>
        <section className="pulse-card min-w-0 p-4 sm:p-5">
          <h2 className="text-[16px] font-semibold tracking-tight">Top posts</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">By views in this period</p>
          <div className="mt-3 flex flex-col gap-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex min-h-[56px] items-center gap-3 p-2">
                <Bar className="h-11 w-11 shrink-0 rounded-xl" />
                <span className="min-w-0 flex-1">
                  <Bar className="h-4 w-3/4" />
                  <Bar className="mt-2.5 h-1.5 w-full rounded-full" />
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
