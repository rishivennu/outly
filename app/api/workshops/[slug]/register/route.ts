import { json, route } from "@/lib/http";
import { cancelRegistration, getWorkshop, registerForWorkshop } from "@/lib/workshops/server";

type Ctx = { params: { slug: string } };

/**
 * R1309: take a seat (signed in; the account's email is the registration, so one person = one seat) or give it back.
 * Replies with the fresh workshop view, which now carries the Meet link for this creator.
 */
export const POST = route<Ctx>(
  async (_req, { params, user }) => {
    const r = await registerForWorkshop(params.slug, { id: user.id, email: user.email, name: user.name }, "web");
    const workshop = await getWorkshop(params.slug, user);
    return json({ ok: true, created: r.created, workshop }, { status: r.created ? 201 : 200 });
  },
  { limit: [20, 60_000] },
);

export const DELETE = route<Ctx>(async (_req, { params, user }) => {
  await cancelRegistration(params.slug, user.email);
  return json({ ok: true, workshop: await getWorkshop(params.slug, user) });
});
