import { requireAdmin } from "@/lib/admin/guard";
import { getConfig } from "@/lib/settings";
import { PageHead } from "@/components/admin/ui";
import { UpdatesEditor } from "@/components/admin/UpdatesEditor";

export const metadata = { title: "Update notice" };
export const dynamic = "force-dynamic";

export default async function UpdatesPage() {
  await requireAdmin("site");
  const notice = await getConfig("updates");
  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Update notice"
        body="Tell members what moved after you ship. Their replies arrive in Tickets."
      />
      <UpdatesEditor initial={notice} />
    </>
  );
}
