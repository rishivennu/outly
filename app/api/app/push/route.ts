import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getCurrentUser, realUserId } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { PUSH_COOKIE, forgetThisDevice } from "@/lib/push/device";

export const dynamic = "force-dynamic";

const body = z.object({ token: z.string().min(20).max(4096), platform: z.enum(["android"]).default("android") });
const forget = z.object({ token: z.string().min(1).max(4096).optional() });

/** The app registered with FCM: remember this phone for the person signed in. */
export const POST = route(
  async (req, { user }) => {
    const { token, platform } = body.parse(await req.json());
    const userId = realUserId(user);
    // A token moves with the phone: whoever signs in on it now gets its notifications.
    const d = await db.pushDevice.upsert({ where: { token }, create: { token, platform, userId }, update: { userId, platform } });
    (await cookies()).set(PUSH_COOKIE, d.id, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return json({ ok: true });
  },
  { limit: [20, 60_000] },
);

/**
 * Notifications turned off in the app: forget this phone (the ol_push cookie). R1294: a body `{ token }` also removes
 * that FCM token's rows for the person signed in, so a phone whose cookie was lost can still unregister.
 */
export const DELETE = route(
  async (req) => {
    const raw = await req.text();
    const token = raw.trim() ? forget.parse(JSON.parse(raw)).token : undefined;
    let removed = await forgetThisDevice();
    const user = token ? await getCurrentUser() : null;
    if (token && user) removed += (await db.pushDevice.deleteMany({ where: { token, userId: realUserId(user) } })).count;
    return json({ ok: true, removed });
  },
  { auth: false, limit: [20, 60_000] },
);
