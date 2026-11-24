import { z } from "zod";
import { realUserId } from "@/lib/auth";
import { HttpError, json, route } from "@/lib/http";
import { createJob, listJobs } from "@/lib/clipper/jobs";
import { EXECUTORS, JOB_STATUSES } from "@/lib/clipper/settings-core";

export const dynamic = "force-dynamic";

const body = z.object({
  mediaId: z.string().min(1).max(64),
  /** Idempotent create: the same key returns the same job. */
  clientKey: z.string().min(1).max(64).optional(),
  settings: z.unknown().optional(),
  executor: z.enum(EXECUTORS).optional(),
});

/** R1321: the owner's clipper jobs, newest first. ?status= narrows, ?limit= up to 100. */
export const GET = route(async (req, { user }) => {
  const q = req.nextUrl.searchParams;
  const status = q.get("status");
  if (status !== null && !(JOB_STATUSES as readonly string[]).includes(status)) throw new HttpError(400, `Pick a status: ${JOB_STATUSES.join(", ")}.`, "BAD_STATUS");
  const limit = q.get("limit") === null ? 20 : Number(q.get("limit"));
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, "Pick a limit from 1 to 100.", "BAD_LIMIT");
  return json({ jobs: await listJobs(user.id, { limit, status: status ?? undefined }) }, { headers: { "cache-control": "private, no-store" } });
});

/** R1321: start a clipper job from an uploaded video (a Media the owner has). 201 when created, 200 when the clientKey matched. */
export const POST = route(
  async (req, { user }) => {
    const b = body.parse(await req.json());
    const r = await createJob(user.id, b, { id: realUserId(user), role: user.role });
    return json(r, { status: r.created ? 201 : 200 });
  },
  { limit: [20, 60_000] },
);
