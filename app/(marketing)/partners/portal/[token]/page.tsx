import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "@/components/marketing/bits";
import { PortalView } from "@/components/partners/PortalView";
import { portalData } from "@/lib/partners/portal";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Partner portal",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await portalData(token);
  return (
    <section className="py-16 sm:py-24">
      <Shell className="max-w-[860px]">
        {data ? (
          <PortalView token={token} data={data} />
        ) : (
          <div className="max-w-xl">
            <h1 className="display text-balance text-[clamp(2rem,5vw,3rem)] leading-[1.1]">This portal link isn&apos;t active</h1>
            <p className="mt-4 text-pretty text-[17px] leading-relaxed text-muted-foreground">
              The portal opens once you accept an offer. Use the link from your acceptance email, or reply to it and we will help.
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
