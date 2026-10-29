import { requireAdmin } from "@/lib/admin/guard";
import { listPlans } from "@/lib/billing/plans";
import { recentGrants } from "@/lib/billing/access";
import { PageHead } from "@/components/admin/ui";
import { PlanGrantsPanel } from "@/components/admin/PlanGrantsPanel";

export const metadata = { title: "Plan grants" };
export const dynamic = "force-dynamic";

export default async function PlanGrantsPage({ searchParams }: { searchParams: { email?: string } }) {
  await requireAdmin("plans");
  const [plans, grants] = await Promise.all([listPlans({ includeHidden: true }), recentGrants()]);
  return (
    <>
      <PageHead
        eyebrow="Run"
        title="Plan grants"
        body="Give someone Creator, Studio or Pro for a set time, by email. Extend, change or revoke it later. Every change is logged with who made it."
      />
      <PlanGrantsPanel
        plans={plans.filter((p) => p.priceMinor > 0).map((p) => ({ slug: p.slug, name: p.name }))}
        initialList={JSON.parse(JSON.stringify(grants))}
        initialEmail={searchParams.email?.slice(0, 200) ?? null}
      />
    </>
  );
}
