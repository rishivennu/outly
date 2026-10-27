import { getCurrentUser } from "@/lib/auth";
import { inbox } from "@/lib/inbox";
import { listThreads } from "@/lib/messages/service";
import { liveNow } from "@/lib/social/registry";
import { InboxView } from "@/components/inbox/InboxView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox" };

export default async function InboxPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const user = (await getCurrentUser())!;
  const [initial, dms, live] = await Promise.all([
    inbox(user.id),
    // A broken messages store must never take the comments inbox down with it.
    listThreads(user.id).catch((e) => {
      console.error("[inbox] messages", e);
      return { threads: [], accounts: 0 };
    }),
    liveNow(),
  ]);
  // Messages (1031) only make sense where Meta delivers them: Instagram or Facebook live, or already connected.
  const showDms = dms.accounts > 0 || dms.threads.length > 0 || live.includes("instagram") || live.includes("facebook");
  return <InboxView initial={initial} dms={showDms ? { ...dms, readOnly: user.role === "editor" } : undefined} initialTab={searchParams?.tab === "messages" ? "messages" : "comments"} />;
}
