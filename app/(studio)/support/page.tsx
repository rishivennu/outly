import { listFaq, FAQ_CATEGORIES } from "@/lib/support/faq";
import { getCurrentUser, realUserId } from "@/lib/auth";
import { listConversations } from "@/lib/support/conversations";
import { PipConversations } from "@/components/support/PipConversations";
import { myTickets } from "@/lib/support/tickets";
import { HelpCenter } from "@/components/support/HelpCenter";
import { MyRequests } from "@/components/support/MyRequests";
import { onboardingFor } from "@/lib/onboarding";

export const dynamic = "force-dynamic";
export const metadata = { title: "Help" };

/** Help inside the dashboard: the same answers as the public /help page, plus the requests this person has open with us. */
export default async function StudioHelp(props: { searchParams: Promise<{ topic?: string; q?: string }> }) {
  const searchParams = await props.searchParams;
  const user = (await getCurrentUser())!;
  const email = user.actor?.email ?? user.email;
  const [faq, tickets, chats, onboarding] = await Promise.all([
    listFaq(),
    // Only this person's own requests: a teammate inside someone else's workspace sees theirs, not the owner's.
    myTickets(user),
    // 1151: this person's own saved Pip chats (the real signed-in person, never the workspace owner's).
    listConversations(realUserId(user)).catch(() => []),
    // Phase 2: the guided setup, to revisit any step from here.
    onboardingFor(user).catch(() => null),
  ]);
  const items = faq.map((f) => ({ id: f.id, category: f.category, q: f.question, a: f.answer }));
  const cats = FAQ_CATEGORIES.filter((c) => items.some((i) => i.category === c));
  const me = { name: user.actor?.name ?? user.name, email };
  return (
    <HelpCenter
      variant="studio"
      items={items}
      categories={cats}
      initialTopic={cats.includes(searchParams.topic as never) ? searchParams.topic! : ""}
      initialQuery={searchParams.q ?? ""}
      me={me}
      extra={
        <>
        <MyRequests
          tickets={tickets}
          onboarding={onboarding}
        />
        <PipConversations items={chats} />
        </>
      }
    />
  );
}
