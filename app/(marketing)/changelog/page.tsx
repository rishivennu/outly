import type { Metadata } from "next";
import { PageHead, Shell } from "@/components/marketing/bits";
import { changelogByDay, changelogDate } from "@/lib/changelog";

export const metadata: Metadata = {
  title: "Changelog",
  description: "What changed in Outlly, newest first. Only changes that are live.",
  alternates: { canonical: "/changelog" },
  openGraph: { title: "Changelog · Outlly", description: "What changed in Outlly, newest first.", url: "/changelog" },
};

export default function ChangelogPage() {
  const days = changelogByDay();
  return (
    <section className="py-16 sm:py-24">
      <Shell>
        <PageHead title="Changelog" lead="What changed in Outlly, newest first. Only changes that are live are listed here." />
        <ol className="mt-14 max-w-[62ch] space-y-12">
          {days.map((d) => (
            <li key={d.date}>
              <h2 className="text-sm font-semibold text-muted-foreground">
                <time dateTime={d.date}>{changelogDate(d.date)}</time>
              </h2>
              <ul className="mt-4 space-y-4">
                {d.entries.map((e) => (
                  <li key={e.title} className="rounded-[1.75rem] border border-border p-6">
                    <h3 className="text-pretty text-[17px] font-semibold tracking-tight">{e.title}</h3>
                    <p className="mt-2 text-pretty text-base leading-relaxed text-muted-foreground">{e.body}</p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </Shell>
    </section>
  );
}
