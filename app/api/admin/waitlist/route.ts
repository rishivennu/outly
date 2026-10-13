import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";

// Bulk email (back-online notice, waitlist invites) can run for up to ~40 s; give the function room.
export const maxDuration = 60;
import { getConfig } from "@/lib/settings";
import { inviteWaitlist, setWaitlist, waitlistCounts, waitlistRecent } from "@/lib/site";

async function state() {
  const c = await getConfig("site");
  return { waitlist: !!c.waitlist, since: c.waitlistSince, counts: await waitlistCounts(), recent: await waitlistRecent(50) };
}

export const GET = adminRoute("site", async () => json(await state()));

const Put = z.object({ waitlist: z.boolean(), inviteAll: z.boolean().optional() });

/** The switch. Turning it off can invite everyone waiting in the same step. */
export const PUT = adminRoute("site", async (req, { admin }) => {
  const b = Put.parse(await req.json());
  const r = await setWaitlist(b.waitlist, admin.name, { inviteAll: b.inviteAll });
  return json({ ...(await state()), invited: r.invited });
}, [20, 60_000]);

const Post = z.object({ ids: z.array(z.string().min(1).max(40)).max(500).optional() });

/** Invite now: the ids given, or everyone still waiting. The switch stays where it is. */
export const POST = adminRoute("site", async (req) => {
  const b = Post.parse(await req.json().catch(() => ({})));
  const invited = await inviteWaitlist(b.ids);
  return json({ ...(await state()), invited });
}, [10, 60_000]);

export const dynamic = "force-dynamic";
