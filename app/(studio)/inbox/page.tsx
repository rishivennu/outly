import { getCurrentUser } from "@/lib/auth";
import { inbox } from "@/lib/inbox";
import { InboxView } from "@/components/inbox/InboxView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox" };

export default async function InboxPage() {
  const user = (await getCurrentUser())!;
  const initial = await inbox(user.id);
  return <InboxView initial={initial} />;
}
