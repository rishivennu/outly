import { z } from "zod";
import { realUserId } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { clipView, discardClip, ownedClip, updateClip } from "@/lib/clipper/jobs";

export const dynamic = "force-dynamic";

const patch = z.object({
  title: z.string().min(1).max(80).optional(),
  hook: z.string().max(300).nullable().optional(),
  caption: z.string().max(2200).nullable().optional(),
  hashtags: z.string().max(300).nullable().optional(),
  start: z.number().min(0).optional(),
  end: z.number().positive().optional(),
  reframe: z.unknown().optional(),
  subtitle: z.unknown().optional(),
});

export const GET = route(async (_req, { user, params }) => json({ clip: clipView(await ownedClip(user.id, params.id)) }, { headers: { "cache-control": "private, no-store" } }));

/** R1321: edit a clip's copy, timing, reframe or subtitles. Timing, reframe and subtitle changes make the render stale. */
export const PATCH = route(
  async (req, { user, params }) => json({ clip: await updateClip(user.id, params.id, patch.parse(await req.json()), { id: realUserId(user), role: user.role }) }),
  { limit: [120, 60_000] },
);

/** R1321: discard a clip (its moment goes back to rejected). A published clip is not discarded here. */
export const DELETE = route(async (_req, { user, params }) => json({ clip: await discardClip(user.id, params.id, { id: realUserId(user), role: user.role }) }), { limit: [60, 60_000] });
