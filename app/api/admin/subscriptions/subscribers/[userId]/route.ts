import { json, HttpError } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { subscriberHistory } from "../../_lib/report";

export const dynamic = "force-dynamic";

export const GET = adminRoute<{ params: { userId: string } }>("pricing", async (_req, { params }) => {
  const h = await subscriberHistory(String(params.userId).slice(0, 40));
  if (!h) throw new HttpError(404, "That account is gone.");
  return json(h);
});
