import Link from "next/link";
import type { CategoryCount } from "@/lib/blog/public";
import { cn } from "@/lib/utils";

/** Topic chips. The current one is marked with aria-current and a filled chip, not colour alone: it also loses its underline and gains a check-style dot. */
export function CategoryNav({ categories, current }: { categories: CategoryCount[]; current?: string }) {
  if (!categories.length) return null;
  const chip = "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-[14px] font-medium";
  return (
    <nav aria-label="Blog topics">
      <ul className="flex flex-wrap gap-2">
        <li>
          <Link href="/blog" aria-current={!current ? "page" : undefined} className={cn(chip, !current ? "border-foreground bg-foreground text-background" : "border-border underline decoration-border underline-offset-4 hover:border-foreground/40")}>
            {!current && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-lime" />}
            All articles
          </Link>
        </li>
        {categories.map((c) => {
          const on = c.slug === current;
          return (
            <li key={c.slug}>
              <Link href={`/blog/category/${c.slug}`} aria-current={on ? "page" : undefined} className={cn(chip, on ? "border-foreground bg-foreground text-background" : "border-border underline decoration-border underline-offset-4 hover:border-foreground/40")}>
                {on && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-lime" />}
                {c.name}
                <span className={cn("text-[12.5px] tabular-nums", on ? "text-background/70" : "text-muted-foreground")}>
                  <span className="sr-only">, </span>
                  {c.count}
                  <span className="sr-only"> {c.count === 1 ? "article" : "articles"}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
