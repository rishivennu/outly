import { HttpError, json, route } from "@/lib/http";
import { portalData } from "@/lib/partners/portal";

export const dynamic = "force-dynamic";

/** The JSON twin of app/(marketing)/partners/portal/[token]/page.tsx for the native app: 404 when the link isn't active. */
export const GET = route<{ params: { token: string } }>(
  async (_req, { params }) => {
    const portal = await portalData(params.token);
    if (!portal) throw new HttpError(404, "This portal link isn't active.", "PORTAL_INACTIVE");
    return json({ portal }, { headers: { "cache-control": "no-store" } });
  },
  { auth: false, limit: [30, 60_000] },
);
