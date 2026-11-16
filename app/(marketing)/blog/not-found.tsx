import Link from "next/link";
import { Shell } from "@/components/marketing/bits";

export default function BlogNotFound() {
  return (
    <section className="py-24 sm:py-32">
      <Shell>
        <div className="max-w-xl">
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">404</p>
          <h1 className="display mt-3 text-balance text-[clamp(2.2rem,5vw,3.25rem)]">This article is not here</h1>
          <p className="mt-5 text-pretty text-[17px] leading-relaxed text-muted-foreground">It may have moved, or it is not published yet. The latest articles are on the blog.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/blog" className="inline-flex h-12 items-center rounded-full bg-foreground px-6 text-[15px] font-semibold text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              Browse the blog
            </Link>
            <Link href="/" className="inline-flex min-h-11 items-center px-2 text-[15px] font-medium underline decoration-border underline-offset-4">
              Outlly home
            </Link>
          </div>
        </div>
      </Shell>
    </section>
  );
}
