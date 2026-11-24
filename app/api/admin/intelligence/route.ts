import { z } from "zod";
import { HttpError, json } from "@/lib/http";
import { db } from "@/lib/db";
import { adminEvent, adminRoute } from "@/lib/admin/route";
import { ACTIVE_MODEL } from "@/lib/intelligence/model/predict";
import { intelligenceGovernance, rebuildShared, resetSharedCache, SHARED_MODEL_KEY } from "@/lib/intelligence/shared";

export const dynamic = "force-dynamic";

/** R1324: the Intelligence governance view as JSON. Aggregates only: no creator, post or prediction is named. */
export const GET = adminRoute("intelligence", async (req) => {
  const weeks = Number(req.nextUrl.searchParams.get("weeks")) || undefined;
  return json(await intelligenceGovernance({ modelKey: ACTIVE_MODEL, weeks }));
});

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rebuild") }),
  z.object({ action: z.literal("status"), key: z.string().min(1).max(60), status: z.enum(["candidate", "active", "retired"]) }),
]);

/**
 * POST { action: "rebuild" } rebuilds the shared baselines now; { action: "status", key, status } moves a model
 * version (retiring the shared document stops every creator reading it at the next cache turn). Both are logged.
 */
export const POST = adminRoute("intelligence", async (req, { admin }) => {
  const body = action.parse(await req.json());
  if (body.action === "rebuild") {
    const r = await rebuildShared();
    await adminEvent("intelligence", `Shared baselines rebuilt: ${r.baselines.buckets.length} buckets from ${r.baselines.owners} creators`, admin.login, "/admin/intelligence");
    return json({ ok: true, buckets: r.baselines.buckets.length, rows: r.baselines.rows, owners: r.baselines.owners, dropped: r.baselines.dropped, optedOut: r.optedOut });
  }
  const v = await db.modelVersion.findUnique({ where: { key: body.key }, select: { key: true, status: true } });
  if (!v) throw new HttpError(404, "No model version with that key.", "NOT_FOUND");
  if (body.key === ACTIVE_MODEL && body.status !== "active") throw new HttpError(409, "The active scorer cannot be retired here; ship a replacement first.", "ACTIVE_SCORER");
  await db.modelVersion.update({ where: { key: body.key }, data: { status: body.status } });
  if (body.key === SHARED_MODEL_KEY) resetSharedCache();
  await adminEvent("intelligence", `Model ${body.key}: ${v.status} -> ${body.status}`, admin.login, "/admin/intelligence");
  return json({ ok: true, key: body.key, status: body.status });
}, [30, 60_000]);
