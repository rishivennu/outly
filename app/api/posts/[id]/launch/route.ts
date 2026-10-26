import { cookies } from "next/headers";
import { json, route } from "@/lib/http";
import { launchSchema } from "@/lib/validation";
import { launchPost, ownedPost, postView } from "@/lib/services";
import type { SimulationMode } from "@/lib/social/types";

const SIMS: SimulationMode[] = ["realistic", "smooth", "instagram-reconnect", "youtube-flaky", "x-rejects"];

export const POST = route(
  async (req, { user, params }) => {
    const body = launchSchema.parse(await req.json());
    // The plan's post slot is taken inside launchPost, before the atomic claim (see holdPostSlot).
    const raw = cookies().get("studio_sim")?.value as SimulationMode | undefined;
    const simulate = raw && SIMS.includes(raw) ? raw : "realistic";
    await launchPost(user.id, params.id, body.mode, body.scheduledAt ? new Date(body.scheduledAt) : null, simulate);
    return json({ post: await postView(await ownedPost(user.id, params.id)) }, { status: 202 });
  },
  { limit: [20, 60_000] },
);
