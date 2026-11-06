import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { campaignPreview, campaignStatus, launchCampaign, processCampaign } from "@/lib/campaigns";

/** One batch of sends can take ~20 s at Resend's rate limit; give the function room. */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** The waitlist update campaign (1142). GET = status, or ?preview=1 for the exact email. */
export const GET = adminRoute("site", async (req) => {
  if (req.nextUrl.searchParams.get("preview")) return json(campaignPreview());
  return json(await campaignStatus());
});

const Post = z.discriminatedUnion("action", [
  z.object({ action: z.literal("launch"), confirm: z.literal(true), expect: z.number().int().min(0).max(1_000_000) }),
  z.object({ action: z.literal("process") }),
]);

/**
 * launch: needs `confirm: true` and the eligible count the admin confirmed; it can only ever succeed once.
 * process: send the next batch now (the admin page calls this while it is open; the cron sweep does it otherwise).
 */
export const POST = adminRoute("site", async (req, { admin }) => {
  const b = Post.parse(await req.json());
  let launched: number | undefined;
  if (b.action === "launch") launched = await launchCampaign(admin.name, b.expect);
  const batch = await processCampaign({ budgetMs: b.action === "launch" ? 12_000 : 20_000, max: 40 });
  return json({ ...(await campaignStatus()), launched, batch });
}, [30, 60_000]);
