import { z } from "zod";
import { json, HttpError } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { cancelJob, JobError, jobView, runStage } from "@/lib/blog/job";

export const dynamic = "force-dynamic";
/** One stage per request: the longest (writing a half) is budgeted at 55 s. */
export const maxDuration = 60;

export const GET = adminRoute<{ params: { id: string } }>("content", async (_req, { params }) => {
  try {
    return json({ job: await jobView(params.id) });
  } catch {
    throw new HttpError(404, "Run not found.", "NOT_FOUND");
  }
});

const Act = z.object({ action: z.enum(["step", "cancel"]) });

/** step: run the current stage and return the job as it now stands. cancel: stop a running job. */
export const POST = adminRoute<{ params: { id: string } }>("content", async (req, { params, admin }) => {
  const { action } = Act.parse(await req.json());
  try {
    const job = action === "cancel" ? await cancelJob(params.id, admin.login) : await runStage(params.id);
    return json({ job });
  } catch (e) {
    if (e instanceof JobError) throw new HttpError(e.status, e.message, "JOB");
    throw e;
  }
}, [120, 60_000]);
