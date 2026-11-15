import { z } from "zod";
import { json } from "@/lib/http";
import { adminEvent, adminRoute } from "@/lib/admin/route";
import { AI_FEATURES, AI_FEATURE_LABEL } from "@/lib/ai/features";
import { aiAccessFor, aiMonitoring, grantAi, type GrantState } from "@/lib/ai/entitlements";

export const dynamic = "force-dynamic";

/**
 * Unlimited AI Access (Phase 3). Same permission as plan grants: giving away AI is a money decision.
 * ?userId= or ?email= -> one account's AI picture. Otherwise the monitoring aggregates (from, to, q, feature, status).
 */
export const GET = adminRoute("users", async (req) => {
  const p = req.nextUrl.searchParams;
  const userId = p.get("userId")?.slice(0, 40);
  const email = p.get("email")?.slice(0, 200);
  if (userId || email) return json(await aiAccessFor({ userId, email }));
  const feature = p.get("feature") ?? "";
  return json(
    await aiMonitoring({
      from: p.get("from") ?? undefined,
      to: p.get("to") ?? undefined,
      q: p.get("q") ?? undefined,
      feature: (AI_FEATURES as readonly string[]).includes(feature) ? (feature as (typeof AI_FEATURES)[number]) : "",
      status: (["active", "expired", "revoked"].includes(p.get("status") ?? "") ? p.get("status") : "") as GrantState | "",
    }),
  );
});

const Post = z
  .object({
    userId: z.string().trim().min(1).max(40).optional(),
    email: z.string().trim().min(3).max(200).optional(),
    features: z.union([z.literal("all"), z.array(z.enum(AI_FEATURES)).min(1, "Pick at least one AI feature.").max(AI_FEATURES.length)]),
    duration: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("permanent") }),
      z.object({ kind: z.literal("days"), days: z.number().int().min(1).max(3660) }),
      z.object({ kind: z.literal("until"), date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.") }),
    ]),
    note: z.string().trim().max(500).default(""),
  })
  .refine((b) => !!b.userId || !!b.email, { message: "Say whose access this is." });

/** End of the chosen day in UTC, so "until 30 Nov" includes all of 30 Nov. */
const endOfDay = (d: string) => new Date(`${d}T23:59:59.999Z`);

export const POST = adminRoute("plans", async (req, { admin }) => {
  const b = Post.parse(await req.json());
  const now = new Date();
  const expiresAt = b.duration.kind === "permanent" ? null : b.duration.kind === "days" ? new Date(now.getTime() + b.duration.days * 864e5) : endOfDay(b.duration.date);
  const r = await grantAi({ userId: b.userId, email: b.email, features: b.features, expiresAt, note: b.note }, { login: admin.login, role: admin.role }, now);
  const what = r.grant.features === "all" ? "all AI features" : r.grant.features.map((f) => AI_FEATURE_LABEL[f]).join(", ");
  await adminEvent("grant", `${admin.name} ${r.changed ? "changed" : "gave"} Unlimited AI Access for ${r.user.email}`, `${what}, ${expiresAt ? `until ${expiresAt.toISOString().slice(0, 10)}` : "permanent"}`, `/admin/ai-usage?q=${encodeURIComponent(r.user.email)}`);
  return json({ grant: r.grant, changed: r.changed, access: await aiAccessFor({ userId: r.user.id }, now) });
}, [30, 60_000]);
