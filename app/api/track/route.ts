import { z } from "zod";
import { realUserId } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { CLIENT_EVENTS, MAX_BATCH, type EventName } from "@/lib/analytics/activity-core";
import { heartbeat, installIdOf, recordEvents, registerInstall, requestPlacement } from "@/lib/analytics/activity";

export const dynamic = "force-dynamic";

/**
 * R1308 App Analytics ingestion. Signed-in people only (the same session cookie as every other route, so nobody can
 * post activity for someone else), a short allow-list of browser events, at most MAX_BATCH per call, server timestamps.
 * `hb` is the visible-tab heartbeat (presence only, never an event); `install` is a confirmed installation signal.
 */
const Body = z
  .object({
    events: z.array(z.object({ n: z.enum(CLIENT_EVENTS as [EventName, ...EventName[]]), meta: z.record(z.string(), z.unknown()).optional() })).max(MAX_BATCH).optional(),
    hb: z.boolean().optional(),
    install: z.object({ id: z.string().min(8).max(64), platform: z.enum(["pwa", "android", "ios"]), source: z.enum(["appinstalled", "standalone", "first_launch"]) }).optional(),
  })
  .strict();

export const POST = route(
  async (req, { user }) => {
    const raw = await req.text();
    const b = Body.parse(raw.trim() ? JSON.parse(raw) : {});
    const userId = realUserId(user);
    const placement = await requestPlacement();
    let written = 0;
    let installed = false;
    if (b.install) {
      const id = installIdOf(b.install.id);
      if (id && placement) installed = await registerInstall({ id, userId, platform: b.install.platform, source: b.install.source, client: placement.client, placement: { ...placement, installId: id } });
    }
    if (b.events?.length) written = await recordEvents(userId, b.events.map((e) => ({ name: e.n, meta: e.meta })), placement);
    if (b.hb) await heartbeat(userId, placement);
    return json({ ok: true, written, installed }, { headers: { "cache-control": "no-store" } });
  },
  { limit: [40, 60_000] },
);
