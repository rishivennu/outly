import { z } from "zod";
import { HttpError, json, route } from "@/lib/http";
import { accountStates, loadRangePage, loadUnscheduled, loadUpcoming } from "@/lib/calendar/load";
import { DRAFTS_PAGE, UPCOMING_PAGE, validRange } from "@/lib/calendar/range";

export const dynamic = "force-dynamic";

const cursor = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).nullish();
const query = z.discriminatedUnion("list", [
  z.object({ list: z.literal("range"), from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }),
  z.object({ list: z.literal("upcoming"), cursor, take: z.coerce.number().int().min(1).max(UPCOMING_PAGE).optional() }),
  z.object({ list: z.literal("drafts"), cursor, take: z.coerce.number().int().min(1).max(DRAFTS_PAGE * 3).optional() }),
]);

/**
 * P2: the calendar's reads, one visible window at a time. range = the days on screen (at most a 6-week month grid);
 * upcoming and drafts page with a cursor. Always the signed-in studio's own posts, through the same profile filter
 * as the page.
 */
export const GET = route(
  async (req, { user }) => {
    const sp = new URL(req.url).searchParams;
    const q = query.parse({ ...Object.fromEntries(sp), list: sp.get("list") ?? "range" });
    const accounts = await accountStates(user.id, user.scope);
    if (q.list === "range") {
      const from = new Date(q.from);
      const to = new Date(q.to);
      if (!validRange(from, to)) throw new HttpError(400, "Pick a range of up to six weeks.", "RANGE");
      const { posts, truncated } = await loadRangePage(user, from, to);
      return json({ posts, nextCursor: null, accounts, truncated });
    }
    const page = q.list === "upcoming" ? await loadUpcoming(user, q.cursor ?? null, q.take) : await loadUnscheduled(user, q.cursor ?? null, q.take);
    return json({ ...page, accounts });
  },
  { limit: [240, 60_000] },
);
