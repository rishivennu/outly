import { json, route } from "@/lib/http";
import { ownedPost, postView } from "@/lib/services";
import { createReviewRequest, reviewsForPost, reviewView } from "@/lib/review";

export const dynamic = "force-dynamic";

/** The token is returned exactly once, here. After this we only ever hold its hash. */
export const POST = route(
  async (_req, { user, params }) => {
    const { url, review } = await createReviewRequest(user.id, params.id, user.actor?.id ?? null);
    return json({ url, review: reviewView(review), post: await postView(await ownedPost(user.id, params.id)) }, { status: 201 });
  },
  { limit: [20, 60_000] },
);

export const GET = route(async (_req, { user, params }) => {
  const post = await ownedPost(user.id, params.id);
  return json({ reviews: (await reviewsForPost(post.id)).map(reviewView) });
});
