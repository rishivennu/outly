import { z } from "zod";
import { json } from "@/lib/http";
import { adminEvent, adminRoute } from "@/lib/admin/route";
import { accessByEmail, createGrant, recentGrants, type Actor } from "@/lib/billing/access";

export const dynamic = "force-dynamic";

const actorOf = (a: { login: string; role: string }): Actor => ({ login: a.login, role: a.role });

/** ?email= -> one account's full plan picture (current access, grants, subscriptions, audit trail). Else the recent grants list. */
export const GET = adminRoute("plans", async (req) => {
  const email = req.nextUrl.searchParams.get("email");
  if (email) return json(await accessByEmail(email.slice(0, 200)));
  const state = req.nextUrl.searchParams.get("state") ?? undefined;
  return json({ grants: await recentGrants({ state }) });
});

const day = z.string().trim().max(40).regex(/^\d{4}-\d{2}-\d{2}/, "Pick a date.");
const Post = z
  .object({
    email: z.string().trim().min(3).max(200),
    plan: z.string().trim().regex(/^[a-z0-9-]{2,40}$/, "Pick a plan."),
    days: z.number().int().min(1).max(3660).nullish(),
    endsAt: day.nullish(),
    startsAt: day.nullish(),
    note: z.string().trim().max(500).default(""),
  })
  .refine((b) => !!b.days !== !!b.endsAt, { message: "Give either a length in days or an end date." });

/** Grant a plan by email. Registered + verified: live now. Otherwise pending until that exact address is verified. */
export const POST = adminRoute("plans", async (req, { admin }) => {
  const b = Post.parse(await req.json());
  const g = await createGrant(b, actorOf(admin));
  await adminEvent("grant", `${admin.name} gave ${g.email} ${g.plan.name}`, g.status === "pending" ? "pending until they verify that email" : `until ${g.endsAt.toISOString().slice(0, 10)}`, `/admin/plans?email=${encodeURIComponent(g.email)}`);
  return json({ id: g.id, status: g.status, access: await accessByEmail(g.email) });
}, [30, 60_000]);
