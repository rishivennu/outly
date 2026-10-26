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
        body="One switch shows or hides every “beta” mention on the site. While it's on, the first members you choose get a one-time code for a free stretch of a paid plan."
      />
      <BetaPanel initial={await betaState()} />
    </>
  );
}
