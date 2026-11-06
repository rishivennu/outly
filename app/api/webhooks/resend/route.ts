import { type NextRequest } from "next/server";
import { json } from "@/lib/http";
import { getConfig } from "@/lib/settings";
import { verifySvix } from "@/lib/campaigns-core";
import { recordProviderEvent } from "@/lib/campaigns";

export const dynamic = "force-dynamic";

/**
 * Resend delivery events (1142): delivered, bounced, complained, failed, keyed by the email id Resend returned when
 * it accepted the send. Only campaign emails are tracked; anything else is acknowledged and ignored.
 * Resend > Webhooks: endpoint {APP_URL}/api/webhooks/resend, then paste its signing secret in Admin > Integrations.
 * Not wrapped in route(): Resend has no session and no Origin header; the Svix signature is the credential.
 */
const MAX_BODY = 256_000;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "too large" }, { status: 413 });
  const secret = (await getConfig("email")).resend.webhookSecret || process.env.RESEND_WEBHOOK_SECRET || "";
  if (!secret) return json({ error: "Webhook secret not set" }, { status: 503 });
  const h = { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") };
  if (!verifySvix(secret, h, raw)) return json({ error: "bad signature" }, { status: 401 });
  let ev: { type?: string; data?: { email_id?: string; bounce?: { message?: string; type?: string }; failed?: { reason?: string } } };
  try {
    ev = JSON.parse(raw);
  } catch {
    return json({ error: "bad json" }, { status: 400 });
  }
  const id = ev.data?.email_id;
  if (!ev.type || !id) return json({ ok: true, ignored: true });
  const detail = ev.data?.bounce?.message ?? ev.data?.failed?.reason ?? (ev.data?.bounce?.type ? `Bounce: ${ev.data.bounce.type}` : undefined);
  const matched = await recordProviderEvent(ev.type, id, detail);
  return json({ ok: true, matched });
}
