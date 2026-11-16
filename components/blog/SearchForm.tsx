import { Search } from "lucide-react";

/** A plain GET form: search works before (and without) any JavaScript. */
export function SearchForm({ q }: { q?: string }) {
  return (
    <form role="search" action="/blog" method="get" className="flex w-full max-w-md items-center gap-2">
      <label htmlFor="blog-q" className="sr-only">
        Search articles
      </label>
      <div className="relative flex-1">
        <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id="blog-q"
          name="q"
          type="search"
          defaultValue={q}
          maxLength={100}
          placeholder="Search articles"
          className="h-12 w-full rounded-full border border-border bg-card/70 pl-11 pr-4 text-[15px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <button type="submit" className="inline-flex h-12 items-center rounded-full bg-foreground px-5 text-[15px] font-semibold text-background transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        Search
      </button>
    </form>
  );
}
