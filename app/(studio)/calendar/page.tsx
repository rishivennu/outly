import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { postFilter } from "@/lib/profiles";
import { postView } from "@/lib/services";
import { CalendarView } from "@/components/calendar/CalendarView";

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
  return <CalendarView initial={await Promise.all(posts.map(postView))} />;
}
