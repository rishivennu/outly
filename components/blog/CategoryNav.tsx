import Link from "next/link";
import type { CategoryCount } from "@/lib/blog/public";
import { cn } from "@/lib/utils";

/** Topic chips. The current one is marked with aria-current and a filled lime chip, not colour alone: it also loses its underline and gains a diamond. */
export function CategoryNav({ categories, current }: { categories: CategoryCount[]; current?: string }) {
  if (!categories.length) return null;
  const chip = "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-[14px] font-medium";
  const off = "border-border bg-card text-foreground underline decoration-border underline-offset-4 hover:border-foreground/40 hover:decoration-current";
  const on = "border-transparent bg-lime text-lime-foreground";
  return (
    <nav aria-label="Blog topics">
      <ul className="flex flex-wrap gap-2">
        <li>
          <Link href="/blog" aria-current={!current ? "page" : undefined} className={cn(chip, !current ? on : off)}>
            {!current && <span aria-hidden="true" className="h-1.5 w-1.5 rotate-45 bg-current" />}
            All articles
          </Link>
        </li>
        {categories.map((c) => {
          const active = c.slug === current;
          return (
            <li key={c.slug}>
              <Link href={`/blog/category/${c.slug}`} aria-current={active ? "page" : undefined} className={cn(chip, active ? on : off)}>
                {active && <span aria-hidden="true" className="h-1.5 w-1.5 rotate-45 bg-current" />}
                {c.name}
                <span className={cn("text-[12.5px] tabular-nums", active ? "text-lime-foreground/80" : "text-muted-foreground")}>
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
