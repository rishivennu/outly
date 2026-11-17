import { requireAdmin } from "@/lib/admin/guard";
import { listPlans } from "@/lib/billing/plans";
import { adminReferrals, referralConfig, referralTotals } from "@/lib/referral";
import { PageHead } from "@/components/admin/ui";
import { ReferralsPanel } from "@/components/admin/ReferralsPanel";

export const metadata = { title: "Refer & Earn" };
export const dynamic = "force-dynamic";

export default async function ReferralsAdminPage() {
  await requireAdmin("referrals");
  const [rows, totals, config, plans] = await Promise.all([adminReferrals(), referralTotals(), referralConfig(), listPlans({ includeHidden: true })]);
  return (
    <>
      <PageHead
        eyebrow="Run"
        title="Refer & Earn"
        body="A sharer earns free plan time when a friend's first payment clears."
      />
      <ReferralsPanel
        initial={JSON.parse(JSON.stringify({ rows, totals, config }))}
        plans={plans.filter((p) => p.priceMinor > 0).map((p) => ({ slug: p.slug, name: p.name }))}
      />
    </>
  );
}
