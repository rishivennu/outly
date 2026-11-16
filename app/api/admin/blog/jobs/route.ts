import { z } from "zod";
import { json, HttpError } from "@/lib/http";
import { adminRoute, adminEvent } from "@/lib/admin/route";
import { db } from "@/lib/db";
import { JobError, recentJobs, startJob, toView } from "@/lib/blog/job";
import { blogReady, blogWebReady } from "@/lib/blog/llm";

export const dynamic = "force-dynamic";

/** Recent runs plus whichever is running now (the generate page polls this). */
export const GET = adminRoute("content", async () => {
  const running = await db.blogJob.findFirst({ where: { status: "running" }, orderBy: { startedAt: "desc" }, include: { events: { orderBy: { createdAt: "asc" } } } });
  return json({ running: running ? toView(running) : null, jobs: await recentJobs(30), ready: blogReady(), web: blogWebReady() });
});

const Start = z.object({ hint: z.string().trim().max(300).optional(), rewriteOf: z.string().trim().max(40).optional() });

/** "Generate Today's Blog". A second click while a run is going returns that run (existed: true), never a second one. */
export const POST = adminRoute("content", async (req, { admin }) => {
  const b = Start.parse(await req.json().catch(() => ({})));
  if (!blogReady()) throw new HttpError(503, "No AI key is set for the blog (KIMI_API_KEY). Add it in the deployment settings.", "NO_AI");
  try {
    const { job, existed } = await startJob({ kind: "manual", by: admin.login, hint: b.hint, rewriteOf: b.rewriteOf });
    if (!existed) await adminEvent("blog.started", `${admin.name} started a blog run`, b.hint ? `Angle: ${b.hint}` : undefined, "/admin/blog/generate");
    return json({ job, existed }, { status: existed ? 200 : 201 });
  } catch (e) {
    if (e instanceof JobError) throw new HttpError(e.status, e.message, "JOB");
    throw e;
  }
}, [20, 60_000]);
