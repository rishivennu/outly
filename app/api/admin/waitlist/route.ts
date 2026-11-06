import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";

// Bulk email (back-online notice, waitlist invites) can run for up to ~40 s; give the function room.
export const maxDuration = 60;
import { getConfig } from "@/lib/settings";
import { inviteWaitlist, setWaitlist, waitlistCounts, waitlistList, type WaitlistQuery } from "@/lib/site";

/** Table filters from the query string (1142). Anything odd falls back to the default rather than erroring. */
const List = z.object({
  q: z.string().max(120).optional().catch(undefined),
  from: z.string().max(10).optional().catch(undefined),
  to: z.string().max(10).optional().catch(undefined),
  sort: z.enum(["new", "old"]).optional().catch(undefined),
  status: z.enum(["all", "waiting", "invited"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
  per: z.coerce.number().int().min(5).max(100).optional().catch(undefined),
});

/** The switch, the counts and one page of members. Counts and members come from WaitlistEntry, whatever the switch says. */
async function state(f: WaitlistQuery = {}) {
  const c = await getConfig("site");
  const [counts, list] = await Promise.all([waitlistCounts(), waitlistList(f)]);
  return { waitlist: !!c.waitlist, since: c.waitlistSince, counts, list };
}

export const GET = adminRoute("site", async (req) => json(await state(List.parse(Object.fromEntries(req.nextUrl.searchParams)))));

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
