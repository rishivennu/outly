import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { blogStats } from "@/lib/blog/posts";

export const dynamic = "force-dynamic";

export const GET = adminRoute("content", async () => json(await blogStats()));
