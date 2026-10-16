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
        body="After you ship changes, tell members what moved. Publishing shows this card once to everyone who joined before it, the next time they open their dashboard, with a button to tell you if anything feels off. Those messages arrive in Tickets."
      />
      <UpdatesEditor initial={notice} />
    </>
  );
}
