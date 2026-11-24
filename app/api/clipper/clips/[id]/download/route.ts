import { json, route } from "@/lib/http";
import { clipDownload } from "@/lib/clipper/jobs";

export const dynamic = "force-dynamic";

/** R1321: the rendered file of a clip (its Media view, with the signed URL the media routes use). */
export const GET = route(async (_req, { user, params }) => json(await clipDownload(user.id, params.id)), { limit: [120, 60_000] });
