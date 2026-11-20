"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PAGE_LIMIT, pageWindow, readPaging } from "./page-window";

export { PAGE_LIMIT, pageWindow, readPaging, type PageWindow } from "./page-window";

/**
 * R1270: Previous / "1-25 of 300" / Next under an admin list, driven by the `page` and `limit` URL params so
 * back/forward, reload and shared links land on the same page. Other params are kept; the default limit is
 * left out of the URL. Renders nothing when everything fits on one page.
 */
export function Pagination({ total, page, limit, label = "Pagination", className }: { total: number; page?: number; limit?: number; label?: string; className?: string }) {
  const sp = useSearchParams();
  const path = usePathname();
  const fromUrl = readPaging(sp, limit ?? PAGE_LIMIT);
  const w = pageWindow(total, page ?? fromUrl.page, limit ?? fromUrl.limit);
  if (w.pages <= 1) return null;
  const href = (p: number) => {
    const n = new URLSearchParams(sp.toString());
    p > 1 ? n.set("page", String(p)) : n.delete("page");
    const q = n.toString();
    return q ? `${path}?${q}` : path;
  };
  const fmt = (v: number) => v.toLocaleString("en-IN");
  const side = (to: number | null, dir: "prev" | "next") => {
    const text = dir === "prev" ? "Previous" : "Next";
    const aria = dir === "prev" ? "Previous page" : "Next page";
    const icon = dir === "prev" ? <ChevronLeft className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />;
    const body = dir === "prev" ? <>{icon}<span className="max-sm:sr-only">{text}</span></> : <><span className="max-sm:sr-only">{text}</span>{icon}</>;
    if (to === null) {
      return <Button type="button" variant="outline" size="sm" disabled aria-label={aria}>{body}</Button>;
    }
    return (
      <Button asChild variant="outline" size="sm">
        <Link href={href(to)} scroll={false} aria-label={aria} rel={dir}>{body}</Link>
      </Button>
    );
  };
  return (
    <nav aria-label={label} className={cn("mt-4 flex items-center justify-between gap-3", className)}>
      {side(w.prev, "prev")}
      <p className="tabular text-[12.5px] text-muted-foreground" aria-live="polite">
        <span className="font-semibold text-foreground">{fmt(w.from)}-{fmt(w.to)}</span> of {fmt(w.total)}
        <span className="sr-only">, page {w.page} of {w.pages}</span>
      </p>
      {side(w.next, "next")}
    </nav>
  );
}
