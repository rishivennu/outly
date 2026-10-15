import { HttpError, json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { getAnalysis } from "@/lib/admin/behavior";

export const dynamic = "force-dynamic";

/** One saved version in full: the model's answer plus the exact snapshot it was given. */
export const GET = adminRoute<{ params: { id: string } }>("insights", async (_req, { params }) => {
  const a = await getAnalysis(params.id);
  if (!a) throw new HttpError(404, "That analysis version doesn't exist.", "NOT_FOUND");
  return json({ analysis: a });
});
