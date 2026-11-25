import { z } from "zod";
import { HttpError, json, route } from "@/lib/http";
import { PLATFORMS } from "@/lib/domain";
import { POST_FORMATS } from "@/lib/formats";
import { resolveClient } from "@/lib/intelligence/client-scope";
import { predictDraft, predictionsOverview } from "@/lib/intelligence/model/predict";
import { requireIntelligence } from "@/lib/intelligence/entitlements";
import { recordJobRun } from "@/lib/intelligence/jobs";
import { kickBackfill } from "@/lib/intelligence/backfill";

export const dynamic = "force-dynamic";

/**
 * R1319: GET /api/intelligence/predictions: what a typical post of each format would do per platform (the creator's
 * calibration of the active model), the model's accuracy so far, and the latest forecasts with their actuals.
 * ?platform= narrows; ?client= (owner only) computes the same for an agency client's destinations.
 * R1338: on the workspace scope the answer carries `coldStart` (no workspace profile yet) and `backfill` (the kick this
 * read gave a missing or stale profile), so "Your baselines" can show the cold-start line while the first build runs.
 */
export const GET = route(
  async (req, { user }) => {
    await requireIntelligence(user.id, "personalized_predictions_enabled");
    const q = req.nextUrl.searchParams;
    const platform = q.get("platform");
    if (platform !== null && !(PLATFORMS as readonly string[]).includes(platform)) throw new HttpError(400, "Unknown platform.", "BAD_PLATFORM");
    const { scopeKey, targetIds } = await resolveClient(user, q.get("client"));
    const [data, kick] = await Promise.all([predictionsOverview(user.id, { scopeKey, targetIds, platform }), scopeKey ? null : kickBackfill(user.id).catch(() => null)]);
    return json({ ...data, coldStart: kick ? kick.coldStart : null, backfill: kick?.verdict ?? null }, { headers: { "cache-control": "private, no-store" } });
  },
  { limit: [60, 60_000] },
);

const Draft = z.object({
  platform: z.enum(PLATFORMS),
  format: z.enum(POST_FORMATS).default("video"),
  title: z.string().max(500).nullish(),
  caption: z.string().max(10_000).nullish(),
  hashtags: z.string().max(2_000).nullish(),
  hook: z.string().max(500).nullish(),
  durationSec: z.number().nonnegative().max(8 * 3600).nullish(),
  width: z.number().int().positive().max(20_000).nullish(),
  height: z.number().int().positive().max(20_000).nullish(),
  scheduledAt: z.string().datetime().nullish(),
  postId: z.string().max(64).nullish(),
});

/**
 * POST /api/intelligence/predictions: score a draft. The answer is an estimate from the creator's own past posts, or,
 * below the personal level on that platform, from the anonymised cohort baseline scaled to their size (the basis names
 * the source and its sample), or null, said plainly, when there is nothing to go on. With postId the forecast is
 * stored (only while the post is a draft or scheduled, never over a judged forecast) and judged later.
 * R1337: each call is timed and logged as IntelligenceJobRun `predict` (duration, level, no owner), the measured latency
 * Admin > AI Management shows; the log never delays or fails the answer.
 */
export const POST = route(
  async (req, { user }) => {
    await requireIntelligence(user.id, "personalized_predictions_enabled");
    const body = Draft.parse(await req.json());
    const startedAt = Date.now();
    let prediction: Awaited<ReturnType<typeof predictDraft>>;
    try {
      prediction = await predictDraft(user.id, body);
    } catch (e) {
      void recordJobRun("predict", { trigger: "api", startedAt, ok: false, error: e });
      throw e;
    }
    void recordJobRun("predict", { trigger: "api", startedAt, ok: true, result: { platform: body.platform, level: prediction?.level ?? null, stored: !!body.postId && !!prediction } });
    return json({ prediction, reason: prediction ? null : "No measured post of yours on this platform yet, so Outlly will not guess a number. Publish a few and the estimate appears." });
  },
  { limit: [30, 60_000] },
);
