import type { Heading } from "@/lib/blog/markdown";

/** Shown only for longer articles (4+ sections). A native <details> so it folds on phones with no script. */
export const tocWorthy = (headings: Heading[]) => headings.filter((h) => h.level === 2).length >= 4;

export function Toc({ headings }: { headings: Heading[] }) {
  if (!tocWorthy(headings)) return null;
  return (
    <nav aria-labelledby="toc-title" className="rounded-[1.75rem] border border-border bg-card/60 p-6">
      <details open className="group">
        <summary className="-m-2 flex min-h-11 cursor-pointer list-none items-center justify-between rounded-2xl p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <span id="toc-title" className="text-[13px] font-semibold uppercase tracking-[0.12em]">
            On this page
          </span>
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 transition-transform group-open:rotate-180">
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <ol className="mt-3 space-y-1 text-[14.5px]">
          {headings.map((h) => (
            <li key={h.id} className={h.level === 3 ? "pl-4" : undefined}>
              <a href={`#${h.id}`} className="flex min-h-11 items-center py-1 leading-snug text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground hover:decoration-lime">
                {h.text}
              </a>
            </li>
          ))}
        </ol>
      </details>
    </nav>
  );
}
