import Link from "next/link";
import { getConfig } from "@/lib/settings";

/** The one place an article mentions the product. Follows Waitlist Mode like the site's other CTAs (middleware would bounce /signup anyway). */
export async function BlogCta() {
  const waitlist = await getConfig("site")
    .then((s) => s.waitlist)
    .catch(() => false);
  return (
    <aside aria-labelledby="blog-cta-title" className="rounded-[1.75rem] bg-foreground p-8 text-background sm:p-10">
      <h2 id="blog-cta-title" className="display max-w-xl text-balance text-[clamp(1.5rem,1.6vw+1rem,2rem)]">
        Want to manage your creator workflow in one place?
      </h2>
      <p className="mt-3 max-w-xl text-pretty text-base leading-relaxed text-background/80">Explore Outlly. Plan, create and publish to every platform from one studio.</p>
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <Link href={waitlist ? "/waitlist" : "/signup"} className="inline-flex h-12 items-center justify-center rounded-full bg-lime px-6 text-[15px] font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime focus-visible:ring-offset-2 focus-visible:ring-offset-foreground">
          {waitlist ? "Join the waitlist" : "Start creating"}
        </Link>
        <Link href="/#features" className="inline-flex min-h-11 items-center px-2 text-[15px] font-medium underline decoration-background/40 underline-offset-4 hover:decoration-lime">
          Explore Outlly
        </Link>
      </div>
    </aside>
  );
}
