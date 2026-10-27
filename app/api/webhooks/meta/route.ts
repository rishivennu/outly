import { type NextRequest } from "next/server";
import { json } from "@/lib/http";
import { creds, loadKeys } from "@/lib/social/keys";
import { safeEqual } from "@/lib/crypto";
import { parseWebhook, verifySignature, webhookVerifyToken } from "@/lib/messages/webhook";
import { ingestEvents } from "@/lib/messages/service";

export const dynamic = "force-dynamic";

/**
 * Meta webhooks for Instagram and Messenger direct messages (1031).
 * Dashboard: Webhooks > Instagram (field "messages") and Webhooks > Page (fields "messages", "message_echoes"),
 * callback {APP_URL}/api/webhooks/meta, verify token from Admin > Social platforms.
 * Not wrapped in route(): Meta has no session and no Origin header; the signature is the credential.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const token = q.get("hub.verify_token") ?? "";
  const challenge = q.get("hub.challenge") ?? "";
  if (q.get("hub.mode") !== "subscribe" || !token || !safeEqual(token, webhookVerifyToken()) || !/^[\w-]{1,200}$/.test(challenge))
    return new Response("Forbidden", { status: 403 });
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}

const MAX_BODY = 1_000_000;
/** Meta wants an answer within about 20 s; a bigger batch is cut (the conversations sync fills any gap). */
const MAX_EVENTS = 200;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "too large" }, { status: 413 });
  await loadKeys();
  // The Messenger (Page) events are signed with the Meta app secret; Instagram Login apps may use their own.
  const secrets = [creds("facebook").clientSecret, creds("instagram").clientSecret];
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), secrets)) return json({ error: "bad signature" }, { status: 403 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad json" }, { status: 400 });
  }
  try {
    await ingestEvents(parseWebhook(body).slice(0, MAX_EVENTS), { profileLookups: 5 });
  } catch (e) {
    console.error("[meta webhook]", e);
    return json({ error: "retry" }, { status: 500 }); // Meta retries; storing is idempotent by message id
  }
  return json({ received: true });
}
