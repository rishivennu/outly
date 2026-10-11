export default function Loading() {
  return (
    <div className="px-5 pb-16 pt-8 sm:px-10 lg:pt-14" aria-busy="true" aria-label="Loading live numbers">
      <div className="h-[52px] w-[420px] max-w-full animate-pulse rounded-full bg-secondary/70" />
      <div className="mt-8 flex items-center gap-4">
        <div className="h-16 w-16 animate-pulse rounded-full bg-secondary" />
        <div className="space-y-2">
          <div className="h-3 w-32 animate-pulse rounded bg-secondary" />
          <div className="h-9 w-64 animate-pulse rounded-xl bg-secondary" />
        </div>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="glass h-[118px] animate-pulse rounded-[24px]" style={{ animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
      <div className="mt-6 grid gap-3 lg:grid-cols-[1.55fr_1fr]">
        <div className="glass h-[340px] animate-pulse rounded-[28px]" />
        <div className="glass h-[340px] animate-pulse rounded-[28px]" />
      </div>
      <p className="mt-6 text-sm text-muted-foreground">Asking the platform for your latest numbers…</p>
    </div>
  );
}
