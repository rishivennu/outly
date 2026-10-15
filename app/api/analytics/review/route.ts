import { HttpError, json, route } from "@/lib/http";
import { currentReview, deepReview, ReviewError } from "@/lib/live/review";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The review on load: the saved Gemini review while fresh, otherwise the rules review from the numbers. */
export const GET = route(async (_req, { user }) => json(await currentReview(user.id)), { limit: [30, 60_000] });

/** Runs the Gemini deep review now. */
export const POST = route(
  async (_req, { user }) => {
    try {
      return json({ review: await deepReview(user.id), ai: true, stale: false });
    } catch (e) {
      if (!(e instanceof ReviewError)) throw e;
      const status = e.code === "NO_AI" ? 503 : e.code === "TOO_SOON" ? 429 : e.code === "NO_DATA" ? 409 : 502;
      if (e.retryAt) return json({ error: e.message, code: e.code, retryAt: e.retryAt }, { status });
      throw new HttpError(status, e.message, e.code);
    }
  },
  { limit: [6, 60_000] },
);
