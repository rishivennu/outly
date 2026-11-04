import { z } from "zod";
import { json, route } from "@/lib/http";
import { recordCampaignEvent } from "@/lib/campaign";
import { CLIENT_EVENTS } from "@/lib/campaign-core";

const Body = z.object({ id: z.string().trim().min(1).max(40), kind: z.enum(CLIENT_EVENTS) });

/** 1122: impression / dismiss / click from the popup. Conversions only come from a confirmed payment, never from here. */
export const POST = route(
  async (req, { user }) => {
    const { id, kind } = Body.parse(await req.json());
    if (user.actor) return json({ ok: true, counted: false });
    return json({ ok: true, counted: await recordCampaignEvent(id, user.id, kind) });
  },
  { limit: [30, 10 * 60_000] },
);
