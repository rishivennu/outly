import Link from "next/link";

export function Breadcrumbs({ trail }: { trail: { name: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-x-2 text-[14px] text-muted-foreground">
        {trail.map((t, i) => (
          <li key={i} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true">/</span>}
            {t.href ? (
              <Link href={t.href} className="inline-flex min-h-11 items-center underline decoration-border underline-offset-4 hover:text-foreground">
                {t.name}
              </Link>
            ) : (
              <span aria-current="page" className="line-clamp-1">
                {t.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
