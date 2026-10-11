import Link from "next/link";
import { OutlyLogo } from "@/components/brand/Logo";
import { SOCIALS } from "@/lib/marketing/content";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/#how", label: "How it works" },
      { href: "/#features", label: "Features" },
      { href: "/#platforms", label: "Platforms" },
      { href: "/#compare", label: "Compare" },
      { href: "/#pricing", label: "Pricing" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/signup", label: "Start creating" },
      { href: "/login", label: "Log in" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
      { href: "/contact", label: "Contact" },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-[1240px] gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <OutlyLogo size={26} className="text-[19px]" />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
            Upload once, publish to Instagram Reels, YouTube Shorts and X, and see what happened to each one.
          </p>
          <ul className="mt-5 flex flex-wrap gap-2">
            {SOCIALS.map((s) => (
              <li key={s.label}>
                <a
                  href={s.href}
                  aria-label={`${s.label} (coming soon)`}
                  className="inline-flex items-center rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  {s.handle}
                </a>
              </li>
            ))}
          </ul>
        </div>

        {COLUMNS.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h2 className="eyebrow mb-4">{col.title}</h2>
            <ul className="flex flex-col gap-2.5">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="mx-auto flex max-w-[1240px] flex-col gap-2 border-t border-border px-5 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>&copy; {new Date().getFullYear()} Outly. In beta.</p>
        <p>Instagram, YouTube and X are trademarks of their owners. Outly is not affiliated with them.</p>
      </div>
    </footer>
  );
}
