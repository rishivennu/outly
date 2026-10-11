import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { postView } from "@/lib/services";
import { ContentLibrary } from "@/components/content/ContentLibrary";

export const dynamic = "force-dynamic";
export const metadata = { title: "Content" };

export default async function ContentPage() {
  const user = (await getCurrentUser())!;
  const posts = await db.post.findMany({ where: { userId: user.id }, include: { targets: true, media: true, reviews: { orderBy: { createdAt: "desc" } } }, orderBy: { updatedAt: "desc" }, take: 200 });
  const metrics = await db.targetMetric.groupBy({ by: ["targetId"], where: { target: { post: { userId: user.id } } }, _sum: { views: true } });
  const targetPost = new Map(posts.flatMap((p) => p.targets.map((t) => [t.id, p.id] as const)));
  const views: Record<string, number> = {};
  for (const m of metrics) {
    const pid = targetPost.get(m.targetId);
    if (pid) views[pid] = (views[pid] ?? 0) + (m._sum.views ?? 0);
  }
  return <ContentLibrary initial={await Promise.all(posts.map(postView))} views={views} />;
}
