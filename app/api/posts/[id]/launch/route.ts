import { cookies } from "next/headers";
import { json, route } from "@/lib/http";
import { launchSchema } from "@/lib/validation";
import { launchPost, ownedPost, postView } from "@/lib/services";
import type { SimulationMode } from "@/lib/social/types";
import { assertPostSchedulable } from "@/lib/posts/guard-server";

const SIMS: SimulationMode[] = ["realistic", "smooth", "instagram-reconnect", "youtube-flaky", "x-rejects"];

export const POST = route(
  async (req, { user, params }) => {
    const body = launchSchema.parse(await req.json());
    // The plan's post slot is taken inside launchPost, before the atomic claim (see holdPostSlot).
    const raw = (await cookies()).get("studio_sim")?.value as SimulationMode | undefined;
    const simulate = raw && SIMS.includes(raw) ? raw : "realistic";
    // Phase 2: booking a time is refused up front for a double booking (409) or a platform rule (422).
    // A failed or partly-sent post sent again goes through here too: launchPost only resends what isn't live.
    if (body.mode === "schedule" && body.scheduledAt) await assertPostSchedulable(user.id, params.id, new Date(body.scheduledAt));
    await launchPost(user.id, params.id, body.mode, body.scheduledAt ? new Date(body.scheduledAt) : null, simulate);
    return json({ post: await postView(await ownedPost(user.id, params.id)) }, { status: 202 });
  },
  { limit: [20, 60_000] },
);
