import "server-only";
import { SignJWT, importPKCS8 } from "jose";
import { db } from "../db";
import { env } from "../env";

/*
 * Push to the Android app through Firebase Cloud Messaging (HTTP v1). Needs FCM_SERVICE_ACCOUNT, the
 * service-account JSON from Firebase (Project settings > Service accounts). Without it push is simply off.
 */

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export function serviceAccount(raw = env.FCM_SERVICE_ACCOUNT): ServiceAccount | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const j = JSON.parse(v.startsWith("{") ? v : Buffer.from(v, "base64").toString("utf8"));
    return j.project_id && j.client_email && j.private_key ? { project_id: j.project_id, client_email: j.client_email, private_key: String(j.private_key).replace(/\\n/g, "\n") } : null;
  } catch {
    return null;
  }
}

export const pushConfigured = () => serviceAccount() !== null;

let cached: { token: string; exp: number } | null = null;

async function accessToken(sa: ServiceAccount) {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(await importPKCS8(sa.private_key, "RS256"));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!r.ok || !j.access_token) throw new Error(`FCM auth failed: ${j.error ?? r.status}`);
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cached.token;
}

export interface PushMessage {
  title: string;
  body: string;
  href?: string | null;
}

/** The FCM v1 message for one phone. A tap opens `href` in the app (the web side routes it). */
export function fcmMessage(token: string, m: PushMessage) {
  return {
    message: {
      token,
      notification: { title: m.title.slice(0, 120), body: m.body.slice(0, 400) },
      data: { href: m.href && /^\/(?![/\\])/.test(m.href) ? m.href : "/home" },
      android: { priority: "HIGH", notification: { channel_id: "outlly_default", icon: "ic_notification", color: "#C4FF00" } },
    },
  };
}

/** Tokens FCM says are gone for good (app uninstalled, data cleared): drop them. Anything else is kept. */
export function isDeadToken(status: number, body: string) {
  // A 400 can also mean our own payload is wrong; only a complaint about the token itself drops it.
  return status === 404 || /UNREGISTERED/.test(body) || (status === 400 && /registration token/i.test(body));
}

/** Best effort: never throws, so a push problem can't hide the notice it came with. */
export async function pushToUser(userId: string, m: PushMessage) {
  const sa = serviceAccount();
  if (!sa) return { sent: 0, dropped: 0 };
  try {
    const devices = await db.pushDevice.findMany({ where: { userId }, select: { id: true, token: true }, take: 10 });
    if (!devices.length) return { sent: 0, dropped: 0 };
    const token = await accessToken(sa);
    let sent = 0;
    const dead: string[] = [];
    await Promise.all(
      devices.map(async (d) => {
        const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(fcmMessage(d.token, m)),
          signal: AbortSignal.timeout(10_000),
        }).catch(() => null);
        if (!r) return;
        if (r.ok) sent++;
        else if (isDeadToken(r.status, await r.text().catch(() => ""))) dead.push(d.id);
      }),
    );
    if (dead.length) await db.pushDevice.deleteMany({ where: { id: { in: dead } } });
    return { sent, dropped: dead.length };
  } catch (e) {
    console.error("[push]", e);
    return { sent: 0, dropped: 0 };
  }
}
