import { HttpError, json, route } from "@/lib/http";
import { reviewDecisionSchema } from "@/lib/validation";
import { decideReview, reviewPackage, reviewView } from "@/lib/review";

export const dynamic = "force-dynamic";

/**
 * The native app reads what app/review/[token]/page.tsx renders server-side (lib/review.ts reviewPackage): the
 * same public object, 404 when the link was replaced or the post removed. No session, no account data.
 */
export const GET = route<{ params: { token: string } }>(
  async (_req, { params }) => {
    const data = await reviewPackage(params.token);
    if (!data) throw new HttpError(404, "This link doesn't work any more.", "REVIEW_GONE");
    return json(data, { headers: { "cache-control": "no-store" } });
  },
  { auth: false, limit: [30, 60_000] },
);

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
