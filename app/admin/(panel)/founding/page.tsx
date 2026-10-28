import { requireAdmin } from "@/lib/admin/guard";
import { foundingState } from "@/lib/founding";
import { PageHead } from "@/components/admin/ui";
import { FoundingPanel } from "@/components/admin/FoundingPanel";

export const metadata = { title: "Founding members" };
export const dynamic = "force-dynamic";

export default async function FoundingAdminPage() {
  await requireAdmin("site");
  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Founding members"
        body="Choose how many founding seats exist. Each goes to a confirmed inbox, gets a number and a stamp, and pays less on every paid plan for life."
      />
      <FoundingPanel initial={await foundingState()} />
    </>
  );
}
