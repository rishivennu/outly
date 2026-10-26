import { type NextRequest } from "next/server";
import { clientIp, json } from "@/lib/http";
import { getConfig } from "@/lib/settings";
import { youpi } from "@/lib/billing/providers";
import { confirmYoupi } from "@/lib/billing/service";
import { youpiOurId } from "@/lib/billing/youpi";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Point YOUPI's merchant webhook at {APP_URL}/api/billing/webhooks/youpi.
 * The signature is checked on the raw body first. Even then the body is only a hint: confirmYoupi
 * re-reads the payment from the gateway, so a replayed or edited event can't grant a plan.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(`youpi-hook:${clientIp(req)}`, 120, 60_000).ok) return json({ error: "slow down" }, { status: 429 });
  const raw = await req.text();
  if (raw.length > 64_000) return json({ error: "too large" }, { status: 413 });
  const cfg = await getConfig("payments");
  if (!youpi.verifyWebhook(cfg.youpi.webhookSecret, raw, req.headers.get("x-gateway-signature"))) return json({ error: "bad signature" }, { status: 401 });
  let ev: any;
  try {
    ev = JSON.parse(raw);
  } catch {
    return json({ error: "bad json" }, { status: 400 });
  }
  // A restarted payment arrives as `<our id>-R1234` on a new YOUPI session: map it back, and name that session.
  const id = youpiOurId(ev?.orderId, ev?.metadata);
  if (!id) return json({ received: true });
  const session = typeof ev?.paymentId === "string" && /^[A-Za-z0-9-]{1,100}$/.test(ev.paymentId) ? ev.paymentId : undefined;
  try {
    await confirmYoupi(id, null, session);
  } catch (e) {
    console.error("[youpi webhook]", (e as Error).message);
    return json({ error: "retry" }, { status: 500 });
  }
  return json({ received: true });
}
