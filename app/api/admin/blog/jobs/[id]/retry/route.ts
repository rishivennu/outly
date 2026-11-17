import { json, HttpError } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { JobError, retryJob } from "@/lib/blog/job";

export const dynamic = "force-dynamic";

/** R1178: resume a failed or stopped run from its first unfinished stage. The generate page then steps it. */
export const POST = adminRoute<{ params: { id: string } }>("content", async (_req, { params, admin }) => {
  try {
    return json({ job: await retryJob(params.id, admin.login) });
  } catch (e) {
    if (e instanceof JobError) throw new HttpError(e.status, e.message, "JOB");
    throw e;
  }
}, [20, 60_000]);
