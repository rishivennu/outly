import { realUserId } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { nativeClient } from "@/lib/native-client";
import { INSTALL_HEADER, installIdOf } from "@/lib/analytics/activity";
import { CrashBody } from "@/lib/crash/core";
import { recordCrashes } from "@/lib/crash/server";

export const dynamic = "force-dynamic";

/**
 * R1329: the native app posts the crashes it saved to disk, on its next launch (outlly-compose CrashReportWorker).
 * Body `{ reports: [{ crashedAt, version, build?, sdk?, device?, exception, message?, stack, thread?, screen? }] }`,
 * at most 10 a call. Platform comes from x-outlly-client; the session names the person (sign-in screen crashes
 * reach Crashlytics only). Answer `{ ok, stored, dropped, alerted }`; `dropped` is the per-day cap, not an error.
 */
export const POST = route(
  async (req, { user }) => {
    const { reports } = CrashBody.parse(await req.json());
    const platform = nativeClient(req)?.platform ?? reports[0].platform ?? "android";
    const r = await recordCrashes({ userId: realUserId(user), installId: installIdOf(req.headers.get(INSTALL_HEADER)), platform, reports });
    return json({ ok: true, ...r });
  },
  { limit: [30, 60_000] },
);
