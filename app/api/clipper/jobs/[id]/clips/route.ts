import { z } from "zod";
import { realUserId } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { clipView, createManualClip, ownedJob } from "@/lib/clipper/jobs";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const body = z.object({ start: z.number().min(0), end: z.number().min(0), title: z.string().trim().max(120).nullable().optional() });

/** R1321: the clips of a job (drafts, approved, published; discarded ones stay out). */
export const GET = route(
  async (_req, { user, params }) => {
    const job = await ownedJob(user.id, params.id);
    const rows = await db.generatedClip.findMany({ where: { jobId: job.id, status: { not: "discarded" } }, orderBy: [{ start: "asc" }, { id: "asc" }] });
    return json({ clips: rows.map(clipView) });
  },
  { limit: [120, 60_000] },
);

/** Cut a clip by hand (a range the creator picked on the timeline). */
export const POST = route(
  async (req, { user, params }) => {
    const b = body.parse(await req.json());
    const clip = await createManualClip(user.id, params.id, b, { id: realUserId(user), role: user.role });
    return json({ clip }, { status: 201 });
  },
  { limit: [60, 60_000] },
);
