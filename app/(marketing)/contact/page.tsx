import type { Metadata } from "next";
import Link from "next/link";
import { Icon3D } from "@/components/brand/Icon3D";
import { PageHead, Prose, Shell } from "@/components/marketing/bits";
import { SOCIALS } from "@/lib/marketing/content";

export const metadata: Metadata = {
  title: "Contact",
  description: "How to reach Outly during beta: in-app support, bug reports with the detail that helps, and where the social accounts will be.",
  alternates: { canonical: "/contact" },
  openGraph: { title: "Contact · Outly", description: "How to reach Outly during beta.", url: "/contact" },
};

const ROUTES = [
  {
    icon: "support" as const,
    title: "Something is broken",
    body: "Signed-in accounts have a support panel in settings. It attaches the post and destination you were on, which is usually the difference between a guess and a fix.",
    cta: { href: "/login", label: "Log in to report it" },
  },
  {
    icon: "inspiration" as const,
    title: "You want something that does not exist yet",
    body: "Feature requests from beta accounts shape the order we build in, particularly around which platform gets connected next.",
    cta: { href: "/signup", label: "Join the beta" },
  },
  {
    icon: "error" as const,
    title: "A publish failed and the reason is unclear",
    body: "Send the destination, the time, and the error text shown on the post. Platform errors are often specific to an account's API access tier, and that detail narrows it down fast.",
    cta: { href: "/#faq", label: "Read the platform FAQ first" },
  },
];

export default function ContactPage() {
  return (
    <section className="py-16 sm:py-24">
      <Shell>
        <PageHead
          title="Contact"
          lead="Outly is a beta run by a small team, so support goes through the app rather than a shared inbox we cannot answer. Here is the quickest route for each kind of message."
        />

        <ul className="mt-14 grid gap-4 md:grid-cols-3">
          {ROUTES.map((r) => (
            <li key={r.title}>
              <article className="flex h-full flex-col rounded-[1.75rem] border border-border p-7">
                <Icon3D name={r.icon} size={80} className="h-14 w-14" />
                <h2 className="mt-6 text-[17px] font-semibold tracking-tight">{r.title}</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{r.body}</p>
                <Link
                  href={r.cta.href}
                  className="mt-auto pt-6 text-sm font-semibold underline decoration-border underline-offset-4 hover:decoration-foreground"
                >
                  {r.cta.label}
                </Link>
              </article>
            </li>
          ))}
        </ul>

        <div className="mt-16">
          <Prose>
            <h2>Social accounts</h2>
            <p>
              Our public accounts go live with the public launch. The links below are placeholders until then — they are listed so you know
              where to look, not because they work yet.
            </p>
          </Prose>
          <ul className="flex flex-wrap gap-2">
            {SOCIALS.map((s) => (
              <li key={s.label}>
                <a
                  href={s.href}
                  aria-label={`${s.label} (placeholder, not live yet)`}
                  className="inline-flex items-center rounded-full border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  {s.handle}
                </a>
              </li>
            ))}
          </ul>

          <Prose>
            <h2>Privacy and legal requests</h2>
            <p>
              Deletion, access and legal questions are covered on the <a href="/privacy">privacy page</a> and the{" "}
              <a href="/terms">terms page</a>. Anything they do not answer should go through the in-app support panel, which reaches the same
              people.
            </p>
          </Prose>
        </div>
      </Shell>
    </section>
  );
}
