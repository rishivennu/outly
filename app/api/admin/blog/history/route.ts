import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { blogHistory } from "@/lib/blog/calendar";

export const dynamic = "force-dynamic";

/** R1178: the latest 60 runs, newest first, with what can be retried. */
export const GET = adminRoute("content", async () => json({ rows: await blogHistory(60) }));
