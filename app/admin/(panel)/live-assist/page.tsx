import { requireAdmin } from "@/lib/admin/guard";
import { PageHead } from "@/components/admin/ui";
import { LiveAssistConsole } from "@/components/admin/liveassist/LiveAssistConsole";

export const metadata = { title: "Live Assist" };
export const dynamic = "force-dynamic";

/** R1184: live chats with customers who asked Pip for a person. The console does the rest from the admin API. */
export default async function LiveAssist() {
  const a = await requireAdmin("live");
  return (
    <>
      <PageHead
        eyebrow="Support"
        title="Live Assist"
        body="Customers who asked Pip for a person wait here. Accept one to chat; Pip stays quiet until you hand the chat back or resolve it."
      />
      <LiveAssistConsole me={{ id: a.id, name: a.name }} role={a.role} />
    </>
  );
}
