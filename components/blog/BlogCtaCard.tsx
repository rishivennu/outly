import Link from "next/link";

/** R1180: the article's Outlly call to action, presentational so the admin preview can show the same card. */
export function BlogCtaCard({ waitlist, preview = false }: { waitlist: boolean; preview?: boolean }) {
  const join = waitlist ? "/waitlist" : "/signup";
  return (
    <aside aria-labelledby={preview ? undefined : "blog-cta-title"} aria-label={preview ? "Outlly call to action" : undefined} className="rounded-2xl bg-foreground p-7 text-background sm:p-9">
      <h2 id={preview ? undefined : "blog-cta-title"} className="display max-w-xl text-balance text-[clamp(1.375rem,1.2vw+1rem,1.75rem)]">
        Want to manage your creator workflow in one place?
      </h2>
      <p className="mt-3 max-w-xl text-pretty text-base leading-relaxed text-background/80">Explore Outlly. Plan, create and publish to every platform from one studio.</p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link href={join} className="inline-flex h-12 items-center justify-center rounded-full bg-lime px-6 text-[15px] font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime focus-visible:ring-offset-2 focus-visible:ring-offset-foreground motion-reduce:transform-none">
          {waitlist ? "Join the waitlist" : "Start creating"}
        </Link>
        <Link href="/#features" className="inline-flex min-h-11 items-center px-2 text-[15px] font-medium underline decoration-background/40 underline-offset-4 hover:decoration-lime">
          Explore Outlly
        </Link>
      </div>
    </aside>
  );
}
