import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { listPosts } from "@/lib/blog/posts";

export const dynamic = "force-dynamic";

export const GET = adminRoute("content", async (req) => {
  const u = req.nextUrl.searchParams;
  return json({ posts: await listPosts({ status: u.get("status") ?? "all", q: u.get("q") ?? "", take: 200 }) });
});
