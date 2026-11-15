import { z } from "zod";
import { json } from "@/lib/http";
import { adminEvent, adminRoute } from "@/lib/admin/route";
import { aiAccessFor, revokeAi } from "@/lib/ai/entitlements";

export const dynamic = "force-dynamic";

const Patch = z.object({ action: z.literal("revoke"), note: z.string().trim().max(300).default("") });

/** Revoke one Unlimited AI Access grant. Limits apply again on the very next AI call. */
export const PATCH = adminRoute<{ params: { id: string } }>("plans", async (req, { admin, params }) => {
  const b = Patch.parse(await req.json());
  const now = new Date();
  const r = await revokeAi(params.id.slice(0, 40), { login: admin.login, role: admin.role }, b.note, now);
  await adminEvent("grant", `${admin.name} revoked Unlimited AI Access for ${r.email}`, b.note || undefined, `/admin/ai-usage?q=${encodeURIComponent(r.email)}`);
  return json({ grant: r.grant, access: await aiAccessFor({ userId: r.userId }, now) });
}, [30, 60_000]);
