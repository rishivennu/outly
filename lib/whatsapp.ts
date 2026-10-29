import "server-only";
import { getConfig, type WhatsAppConfig } from "./settings";
import { maskPhone, redactCode, whatsappCodePayload } from "./phone";

/**
 * WhatsApp codes through Meta's WhatsApp Cloud API (graph.facebook.com), no middleman. Needs, from
 * Admin > Integrations: the Phone number ID, a permanent system-user token with whatsapp_business_messaging,
 * and an approved Authentication template (copy-code button). Off until the admin switches it on.
 */
export const GRAPH = "https://graph.facebook.com/v24.0";

export const whatsappReady = (c: WhatsAppConfig) => !!(c.enabled && c.phoneNumberId && c.token && c.template);

/** True when sign-in pages may offer WhatsApp. Cached with the rest of the config (15 s). */
export async function whatsappAvailable() {
  return whatsappReady(await getConfig("whatsapp"));
}

type GraphError = { error?: { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string } } };

/** Turns Meta's error into one plain line for the admin (codes redacted). */
function explain(body: GraphError, status: number, code: string) {
  const e = body.error;
  const raw = e?.error_data?.details || e?.message || `HTTP ${status}`;
  const hint =
    e?.code === 190 ? "The access token is wrong or expired. Make a new system-user token." :
    e?.code === 132001 ? "Meta can't find that template in this language. Check the name and language, and that it's approved." :
    e?.code === 131026 ? "That number can't get WhatsApp messages (no WhatsApp, or an old app version)." :
    e?.code === 131042 ? "Meta has no payment method for this WhatsApp account. Add one in Business Settings > WhatsApp accounts." :
    e?.code === 133010 ? "The sending number isn't registered with the Cloud API yet." :
    e?.code === 100 ? "Meta rejected a field. Check the Phone number ID." : "";
  return redactCode(`${hint ? `${hint} ` : ""}(Meta: ${raw}${e?.code ? `, code ${e.code}` : ""})`, code);
}

export async function sendWhatsAppCode(to: string, code: string, cfg?: WhatsAppConfig): Promise<{ ok: boolean; error?: string; id?: string }> {
  const c = cfg ?? (await getConfig("whatsapp"));
  if (!whatsappReady(c)) return { ok: false, error: "WhatsApp codes are switched off in Admin > Integrations." };
  try {
    const r = await fetch(`${GRAPH}/${encodeURIComponent(c.phoneNumberId)}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" },
      body: JSON.stringify(whatsappCodePayload(to, code, c.template, c.lang)),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const body = (await r.json().catch(() => ({}))) as GraphError & { messages?: { id: string }[] };
    if (!r.ok) return { ok: false, error: `WhatsApp to ${maskPhone(to)} failed. ${explain(body, r.status, code)}` };
    return { ok: true, id: body.messages?.[0]?.id };
  } catch (e) {
    const timeout = (e as Error)?.name === "TimeoutError";
    return { ok: false, error: timeout ? "Meta didn't answer within 10 seconds." : redactCode(`Couldn't reach Meta: ${(e as Error)?.message ?? e}`, code) };
  }
}

/** Admin "Check connection": reads the sending number, which proves the ID and token without messaging anyone. */
export async function checkWhatsApp(cfg?: WhatsAppConfig): Promise<{ ok: boolean; message: string }> {
  const c = cfg ?? (await getConfig("whatsapp"));
  if (!c.phoneNumberId || !c.token) return { ok: false, message: "Add the Phone number ID and the access token first." };
  try {
    const r = await fetch(`${GRAPH}/${encodeURIComponent(c.phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`, {
      headers: { authorization: `Bearer ${c.token}` },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const b = (await r.json().catch(() => ({}))) as GraphError & { display_phone_number?: string; verified_name?: string; quality_rating?: string };
    if (!r.ok) return { ok: false, message: explain(b, r.status, "") };
    return { ok: true, message: `Connected: ${b.verified_name ?? "your business"} on ${b.display_phone_number ?? "this number"}${b.quality_rating ? `, quality ${b.quality_rating.toLowerCase()}` : ""}.${c.enabled ? "" : " Switch it on to start sending codes."}` };
  } catch (e) {
    return { ok: false, message: (e as Error)?.name === "TimeoutError" ? "Meta didn't answer within 10 seconds." : `Couldn't reach Meta: ${(e as Error)?.message ?? e}` };
  }
}
