import { requireAdmin } from "@/lib/admin/guard";
import { PageHead } from "@/components/admin/ui";
import { LiveAssistConsole } from "@/components/admin/liveassist/LiveAssistConsole";

export const metadata = { title: "Live Support" };
export const dynamic = "force-dynamic";

/** R1184: live chats with customers who asked Pip for a person. The console does the rest from the admin API. */
export default async function LiveAssist() {
  const a = await requireAdmin("live");
  return (
    <>
      <PageHead tight eyebrow="Support" title="Live Support" body="Customers waiting for a person. Join one to chat; Pip stays quiet until you resolve it." />
      <LiveAssistConsole me={{ id: a.id, name: a.name }} role={a.role} />
    </>
  );
}
