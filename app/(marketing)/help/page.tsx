import type { Metadata } from "next";
import { headers } from "next/headers";
import { listFaq, FAQ_CATEGORIES } from "@/lib/support/faq";
import { getCurrentUser } from "@/lib/auth";
import { HelpCenter } from "@/components/support/HelpCenter";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Help centre", description: "Answers about Outlly billing, publishing and your account, plus a direct line to a person.", alternates: { canonical: "/help" } };

export default async function HelpPage({ searchParams }: { searchParams: { topic?: string; q?: string } }) {
  const [faq, user] = await Promise.all([listFaq(), getCurrentUser().catch(() => null)]);
  const items = faq.map((f) => ({ id: f.id, category: f.category, q: f.question, a: f.answer }));
  const cats = FAQ_CATEGORIES.filter((c) => items.some((i) => i.category === c));
  const jsonLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) };
  return (
    <>
      <script type="application/ld+json" nonce={headers().get("x-nonce") ?? undefined} dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <HelpCenter items={items} categories={cats} initialTopic={cats.includes(searchParams.topic as never) ? searchParams.topic! : ""} initialQuery={searchParams.q ?? ""} me={user ? { name: user.name, email: user.email } : null} />
    </>
  );
}
