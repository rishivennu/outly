import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "@/components/marketing/bits";
import { OfferView } from "@/components/partners/OfferView";
import { getOfferByToken } from "@/lib/partners/offers";

export const dynamic = "force-dynamic";

// A private link: never indexed, and the token never leaks to another site through the Referer header.
export const metadata: Metadata = {
  title: "Your partnership offer",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function OfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const offer = await getOfferByToken(token);
  return (
    <section className="py-16 sm:py-24">
      <Shell className="max-w-[760px]">
        {offer ? (
          <OfferView token={token} offer={offer} />
        ) : (
          <div className="max-w-xl">
            <h1 className="display text-balance text-[clamp(2rem,5vw,3rem)] leading-[1.1]">This offer link isn&apos;t valid</h1>
            <p className="mt-4 text-pretty text-[17px] leading-relaxed text-muted-foreground">
              Check that you opened the full link from your email. If it still does not work, reply to that email and we will send a new one.
            </p>
            <Link href="/partners" className="mt-6 inline-flex min-h-11 items-center text-[15px] font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              About the Creator Partnership Program
            </Link>
          </div>
        )}
      </Shell>
    </section>
  );
}
