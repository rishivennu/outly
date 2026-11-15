import { HttpError, json, route } from "@/lib/http";
import { checkPostSchedule } from "@/lib/posts/guard-server";

export const dynamic = "force-dynamic";

/**
 * Phase 2: dry run of the booking checks for moving a post to `at` (the calendar's move dialog asks before it
 * saves). Nothing changes. Same rules as PATCH /api/posts/[id] and launch: time, double booking, platform rules.
 */
export const GET = route(
  async (req, { user, params }) => {
    const raw = req.nextUrl.searchParams.get("at") ?? "";
    const at = new Date(raw);
    if (!raw || !Number.isFinite(at.getTime())) throw new HttpError(400, "Pick a date and time.", "VALIDATION");
    const r = await checkPostSchedule(user.id, params.id, at);
    return json({ ok: r.issues.length === 0, issues: r.issues, conflicts: r.conflicts });
  },
  { limit: [120, 60_000] },
);
