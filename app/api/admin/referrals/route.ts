import { z } from "zod";
import { revalidatePath } from "next/cache";
import { json } from "@/lib/http";
import { adminEvent, adminRoute } from "@/lib/admin/route";
import { saveConfig } from "@/lib/settings";
import { listPlans } from "@/lib/billing/plans";
import { normalizeReferral } from "@/lib/referral-core";
import { adminReferrals, adminRevokeReferral, referralConfig, referralTotals } from "@/lib/referral";
import { audit, type Actor } from "@/lib/billing/access";

export const dynamic = "force-dynamic";

const actorOf = (a: { login: string; role: string }): Actor => ({ login: a.login, role: a.role });
const STATUSES = ["invited", "registered", "paid", "rewarded", "disqualified"] as const;

export const GET = adminRoute("referrals", async (req) => {
  const q = req.nextUrl.searchParams;
  const status = q.get("status");
  const [rows, totals, config] = await Promise.all([
    adminReferrals({ search: q.get("search")?.slice(0, 120) ?? undefined, status: status && (STATUSES as readonly string[]).includes(status) ? status : undefined, flagged: q.get("flagged") === "1" }),
    referralTotals(),
    referralConfig(),
  ]);
  return json({ rows, totals, config });
});

const Put = z.object({
  enabled: z.boolean().optional(),
  rewardPlan: z.string().trim().regex(/^[a-z0-9-]{2,40}$/).optional(),
  rewardDays: z.number().int().min(1).max(365).optional(),
  eligiblePlans: z.array(z.string().trim().regex(/^[a-z0-9-]{2,40}$/)).max(12).optional(),
});

/** Refer & Earn settings. Only rewards issued after the save use the new terms; earned ones stay as they are. */
export const PUT = adminRoute("referrals", async (req, { admin }) => {
  const b = Put.parse(await req.json());
  const before = await referralConfig();
  const known = (await listPlans({ includeHidden: true })).filter((p) => p.priceMinor > 0).map((p) => p.slug);
  const next = normalizeReferral({ ...before, ...b }, known);
  if (b.eligiblePlans && next.eligiblePlans.length === 0) return json({ error: "Pick at least one paid plan that qualifies.", code: "VALIDATION" }, { status: 400 });
  // saveConfig merges objects, but arrays are replaced whole, which is what we want for the eligible list.
  await saveConfig("referral", next);
  await audit({ actor: actorOf(admin), action: "referral.config", targetType: "config", targetId: "referral", before, after: next });
  await adminEvent("referral", `${admin.name} updated Refer & Earn`, `${next.enabled ? "on" : "off"}, ${next.rewardDays} days of ${next.rewardPlan}`, "/admin/referrals");
  for (const p of ["/settings", "/signup", "/terms"]) revalidatePath(p);
  return json({ config: next });
}, [30, 60_000]);

const Post = z.object({ action: z.literal("revoke"), id: z.string().min(1).max(40), reason: z.string().trim().min(3, "Say why, for the audit trail.").max(300) });

/** Disqualify a referral after an investigation. Ends its reward if one was issued; logged with the reason. */
export const POST = adminRoute("referrals", async (req, { admin }) => {
  const b = Post.parse(await req.json());
  const r = await adminRevokeReferral(b.id, b.reason, actorOf(admin));
  if (!r) return json({ error: "Referral not found.", code: "NOT_FOUND" }, { status: 404 });
  await adminEvent("referral", `${admin.name} disqualified a referral`, b.reason, "/admin/referrals");
  return json({ ok: true, totals: await referralTotals() });
}, [30, 60_000]);
