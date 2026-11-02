import { json, route } from "@/lib/http";
import { ownedPost } from "@/lib/services";
import { postInsights } from "@/lib/insights/post";
import { limitShared } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * 1088: live analytics for one post, per destination. ?fresh=1 is the popup's refresh button.
 * Ownership and account scope are checked first (ownedPost), so the cache key can never serve
 * another person's numbers. Answers are private and never stored by the browser or a CDN.
 */
export const GET = route(
  async (req, { user, params }) => {
    const post = await ownedPost(user.id, params.id);
    // Refreshes fan out to the platforms, so they are held far tighter than plain reads.
    const wanted = req.nextUrl.searchParams.get("fresh") === "1";
    const fresh = wanted && (await limitShared(`insights-fresh:${user.id}`, 12, 60_000)).ok;
    const data = await postInsights(user.id, post.id, { fresh });
    // Over the limit the held numbers are served, and the popup says so instead of pretending it refreshed.
    return json({ ...data, ...(wanted && !fresh ? { refreshLimited: true } : {}) }, { headers: { "cache-control": "private, no-store" } });
  },
  { limit: [60, 60_000] },
);
