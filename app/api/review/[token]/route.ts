import { json, route } from "@/lib/http";
import { reviewDecisionSchema } from "@/lib/validation";
import { decideReview, reviewView } from "@/lib/review";

export const dynamic = "force-dynamic";

/**
 * Public: the token in the URL is the only credential. No session, no account data in the response.
 * Rate limited hard because this endpoint is reachable without signing in.
 */
export const POST = route<{ params: { token: string } }>(
  async (req, { params }) => {
    const body = reviewDecisionSchema.parse(await req.json());
    const review = await decideReview(params.token, body);
    return json({ review: reviewView(review) });
  },
  { auth: false, limit: [10, 60_000] },
);
