import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { postFilter } from "@/lib/profiles";
import { postView } from "@/lib/services";
import { CalendarView } from "@/components/calendar/CalendarView";
import { PageFresh } from "@/components/shell/PageFresh";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendar" };

export default async function CalendarPage() {
  const user = (await getCurrentUser())!;
  const since = new Date(Date.now() - 90 * 864e5);
  const posts = await db.post.findMany({
    where: { userId: user.id, ...(await postFilter(user)).where, OR: [{ scheduledAt: { gte: since } }, { publishedAt: { gte: since } }] },
    include: { targets: true, media: true, reviews: { orderBy: { createdAt: "desc" } } },
    orderBy: { scheduledAt: "asc" },
    take: 300,
  });
  // 1114: may open from the background preload; brings itself up to date when that copy is 2 minutes old.
  return (
    <>
      <PageFresh renderedAt={Date.now()} maxAge={120_000} />
      <CalendarView initial={await Promise.all(posts.map(postView))} />
    </>
  );
}
