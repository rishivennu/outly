import { z } from "zod";
import { json } from "@/lib/http";
import { adminEvent, adminRoute } from "@/lib/admin/route";
import { accessByEmail, changeGrant, extendGrant, revokeGrant, type Actor } from "@/lib/billing/access";

export const dynamic = "force-dynamic";

const actorOf = (a: { login: string; role: string }): Actor => ({ login: a.login, role: a.role });
const day = z.string().trim().max(40).regex(/^\d{4}-\d{2}-\d{2}/, "Pick a date.");

const Patch = z.discriminatedUnion("action", [
  z.object({ action: z.literal("extend"), days: z.number().int().min(1).max(3660).nullish(), endsAt: day.nullish(), note: z.string().trim().max(500).default("") }),
  z.object({ action: z.literal("change"), plan: z.string().trim().regex(/^[a-z0-9-]{2,40}$/, "Pick a plan."), note: z.string().trim().max(500).default("") }),
  z.object({ action: z.literal("revoke"), reason: z.string().trim().min(3, "Say why, for the audit trail.").max(300) }),
]);

/** Extend, upgrade/downgrade or revoke one grant. Every change lands in the audit log with before and after. */
export const PATCH = adminRoute<{ params: { id: string } }>("plans", async (req, { admin, params }) => {
  const b = Patch.parse(await req.json());
  if (b.action === "extend" && !!b.days === !!b.endsAt) return json({ error: "Give either extra days or a new end date.", code: "VALIDATION" }, { status: 400 });
  const id = params.id.slice(0, 40);
  const actor = actorOf(admin);
  const g =
    b.action === "extend" ? await extendGrant(id, b, actor)
    : b.action === "change" ? await changeGrant(id, b, actor)
    : await revokeGrant(id, b.reason, actor);
  const what = b.action === "extend" ? `extended ${g.email}'s grant to ${g.endsAt.toISOString().slice(0, 10)}` : b.action === "change" ? `moved ${g.email}'s grant to ${g.plan.name}` : `revoked ${g.email}'s grant`;
  await adminEvent("grant", `${admin.name} ${what}`, b.action === "revoke" ? b.reason : b.note || undefined, `/admin/plans?email=${encodeURIComponent(g.email)}`);
  return json({ id: g.id, status: g.status, access: await accessByEmail(g.email) });
}, [30, 60_000]);
