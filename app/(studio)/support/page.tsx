import { listFaq, FAQ_CATEGORIES } from "@/lib/support/faq";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { HelpCenter } from "@/components/support/HelpCenter";
import { MyRequests } from "@/components/support/MyRequests";

export const dynamic = "force-dynamic";
export const metadata = { title: "Help" };

/** Help inside the dashboard: the same answers as the public /help page, plus the requests this person has open with us. */
export default async function StudioHelp({ searchParams }: { searchParams: { topic?: string; q?: string } }) {
  const user = (await getCurrentUser())!;
  const email = user.actor?.email ?? user.email;
  const [faq, tickets] = await Promise.all([
    listFaq(),
    db.ticket.findMany({
      // Only this person's own requests: a teammate inside someone else's workspace sees theirs, not the owner's.
      where: user.actor ? { email } : { OR: [{ userId: user.id }, { email }] },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true,
        ref: true,
        subject: true,
        status: true,
        updatedAt: true,
        messages: { where: { author: "admin" }, orderBy: { createdAt: "desc" }, take: 1, select: { body: true, authorName: true, createdAt: true } },
      },
    }),
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
        <MyRequests
          tickets={tickets.map((t) => ({
            ref: t.ref,
            subject: t.subject,
            status: t.status,
            updatedAt: t.updatedAt.toISOString(),
            reply: t.messages[0] ? { body: t.messages[0].body, by: t.messages[0].authorName ?? "Outlly support" } : null,
          }))}
        />
      }
    />
  );
}
