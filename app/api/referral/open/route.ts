import { clientIp, json, route } from "@/lib/http";
import { recordOpen } from "@/lib/referral";
import { REF_COOKIE, REF_VISITOR } from "@/lib/referral-core";

export const dynamic = "force-dynamic";

/**
 * The signup page reports an opened share link once (1052), so the sharer sees "Invited". Reads only the
 * cookies the middleware set from ?ref=CODE: a stranger can't credit a code without visiting its link.
 */
export const POST = route(
  async (req) => {
    const ok = await recordOpen(req.cookies.get(REF_COOKIE)?.value, req.cookies.get(REF_VISITOR)?.value, clientIp(req));
    return json({ ok });
  },
  { auth: false, limit: [6, 60_000] },
);
