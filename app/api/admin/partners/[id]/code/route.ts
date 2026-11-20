import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { attributionSummary, ensurePartnerCode, partnerLink } from "@/lib/partners/attribution";

export const dynamic = "force-dynamic";

/** Makes (or returns) the creator's referral code, with the link and the counts. */
export const POST = adminRoute<{ params: { id: string } }>("partners", async (_req, { params }) => {
  const code = await ensurePartnerCode(params.id);
  return json({ code, link: partnerLink(code), attribution: await attributionSummary(params.id) });
}, [20, 60_000]);
