import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { postFilter } from "@/lib/profiles";
import { postView } from "@/lib/services";
import { ApprovalsBoard } from "@/components/approvals/ApprovalsBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const user = (await getCurrentUser())!;
  const posts = await db.post.findMany({
    where: { userId: user.id, ...(await postFilter(user)).where, status: { notIn: ["published", "publishing"] }, OR: [{ requireApproval: true }, { reviews: { some: {} } }] },
    include: { targets: true, media: true, reviews: { orderBy: { createdAt: "desc" } } },
    orderBy: [{ scheduledAt: "asc" }, { updatedAt: "desc" }],
    take: 200,
  });
  return <ApprovalsBoard initial={await Promise.all(posts.map(postView))} />;
}
