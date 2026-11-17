import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/** A plain GET form: search works before (and without) any JavaScript. One outlined pill holds the field and the button. */
export function SearchForm({ q, className }: { q?: string; className?: string }) {
  return (
    <form role="search" action="/blog" method="get" className={cn("flex w-full max-w-md items-center gap-1 rounded-full border border-border bg-card p-1 focus-within:ring-2 focus-within:ring-ring", className)}>
      <label htmlFor="blog-q" className="sr-only">
        Search articles
      </label>
      <Search aria-hidden="true" className="ml-3 h-4 w-4 shrink-0 text-muted-foreground" />
      <input
        id="blog-q"
        name="q"
        type="search"
        defaultValue={q}
        maxLength={100}
        placeholder="Search articles"
        className="h-11 min-w-0 flex-1 bg-transparent px-2 text-[15px] placeholder:text-muted-foreground focus-visible:outline-none"
      />
      <button type="submit" className="inline-flex h-11 shrink-0 items-center rounded-full bg-foreground px-5 text-[14px] font-semibold text-background transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Search
      </button>
    </form>
  );
}
