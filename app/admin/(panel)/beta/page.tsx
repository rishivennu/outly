import { requireAdmin } from "@/lib/admin/guard";
import { betaState } from "@/lib/beta";
import { PageHead } from "@/components/admin/ui";
import { BetaPanel } from "@/components/admin/BetaPanel";

export const metadata = { title: "Beta program" };
export const dynamic = "force-dynamic";

export default async function BetaAdminPage() {
  await requireAdmin("site");
  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Beta program"
        body="Show or hide every beta mention, and pick who gets an early-access code."
      />
      <BetaPanel initial={await betaState()} />
    </>
  );
}
