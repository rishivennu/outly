import type { Metadata } from "next";
import { Shell } from "@/components/marketing/bits";
import { DeletionStatus } from "@/components/account/DeletionStatus";

export const metadata: Metadata = { title: "Account deleted", robots: { index: false, follow: false } };

/**
 * Where a person lands after deleting their account (1053). The status token rides in the URL hash, so it
 * never reaches a server log or a Referer header; the client posts it to /api/account-deletion and shows
 * the file cleanup as it finishes.
 */
export default function AccountDeletedPage() {
  return (
    <section className="py-16 sm:py-24" aria-labelledby="deleted-title">
      <Shell>
        <div className="max-w-xl">
          <p className="eyebrow mb-5">Account</p>
          <h1 id="deleted-title" className="display text-balance text-[clamp(2.2rem,6vw,3.4rem)]">Your account is deleted</h1>
          <div className="mt-6 text-pretty text-[17px] leading-relaxed text-muted-foreground">
            <DeletionStatus />
          </div>
        </div>
      </Shell>
    </section>
  );
}
