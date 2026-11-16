import Link from "next/link";
import { pageHref } from "@/lib/blog/public";
import { cn } from "@/lib/utils";

/** Numbered pages with first, last and the two around the current one; gaps shown as an ellipsis. */
export function Pagination({ path, page, pages, q }: { path: string; page: number; pages: number; q?: string }) {
  if (pages <= 1) return null;
  const nums = [...new Set([1, page - 1, page, page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const btn = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-4 text-[14px] font-medium";
  return (
    <nav aria-label="Pages" className="mt-12">
      <ul className="flex flex-wrap items-center gap-2">
        {page > 1 && (
          <li>
            <Link href={pageHref(path, { q, page: page - 1 })} rel="prev" className={cn(btn, "border-border underline decoration-border underline-offset-4")}>
              Previous
            </Link>
          </li>
        )}
        {nums.map((n, i) => (
          <li key={n} className="flex items-center gap-2">
            {i > 0 && n - nums[i - 1] > 1 && <span aria-hidden="true" className="px-1 text-muted-foreground">...</span>}
            {n === page ? (
              <span aria-current="page" className={cn(btn, "border-foreground bg-foreground text-background")}>
                <span className="sr-only">Page </span>
                {n}
              </span>
            ) : (
              <Link href={pageHref(path, { q, page: n })} className={cn(btn, "border-border underline decoration-border underline-offset-4")}>
                <span className="sr-only">Page </span>
                {n}
              </Link>
            )}
          </li>
        ))}
        {page < pages && (
          <li>
            <Link href={pageHref(path, { q, page: page + 1 })} rel="next" className={cn(btn, "border-border underline decoration-border underline-offset-4")}>
              Next
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
}
