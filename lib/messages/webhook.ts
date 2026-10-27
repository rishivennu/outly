import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env";
import { hmac } from "../crypto";
import type { DmPlatform } from "./meta";

/**
 * Meta webhooks for direct messages (1031). Endpoint: {APP_URL}/api/webhooks/meta
 *  - GET  ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...  -> echo the challenge when the token matches.
 *  - POST JSON, signed: X-Hub-Signature-256: sha256=<hex HMAC of the raw body with the app secret>.
 * Instagram Login apps have their own secret next to the Meta app secret, so either of our two secrets is accepted.
 */

/** Paste this into the Meta dashboard's "Verify token". Fixed per deploy; shown in Admin > Social platforms. */
export function webhookVerifyToken(): string {
  return env.META_WEBHOOK_VERIFY_TOKEN || `outlly-${hmac("meta-webhook-verify-token").slice(0, 24)}`;
}

export function verifySignature(raw: string, header: string | null, secrets: string[]): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const got = Buffer.from(header.slice(7), "hex");
  if (got.length !== 32) return false;
  return secrets.filter(Boolean).some((s) => {
    const want = createHmac("sha256", s).update(raw, "utf8").digest();
    return timingSafeEqual(want, got);
  });
}

export interface DmEvent {
  platform: DmPlatform;
  /** Our side: Instagram professional account id, or Page id. Matches SocialAccount.platformUserId. */
  accountPlatformId: string;
  /** The other person (IGSID / PSID). */
  personId: string;
  mid: string;
  direction: "in" | "out";
  text: string;
  attachments: { type: string; url: string | null }[];
  sentAt: Date;
  /** The person unsent it: remove our copy too. */
  deleted?: boolean;
}

type Msg = { mid?: string; text?: string; is_echo?: boolean; is_deleted?: boolean; is_unsupported?: boolean; attachments?: { type?: string; payload?: { url?: string } }[] };
type Messaging = { sender?: { id?: string }; recipient?: { id?: string }; timestamp?: number | string; message?: Msg; postback?: { mid?: string; title?: string; payload?: string } };
type Entry = { id?: string; time?: number; messaging?: Messaging[]; changes?: { field?: string; value?: Messaging }[] };

function one(platform: DmPlatform, entryId: string, m: Messaging): DmEvent | null {
  const sender = m.sender?.id;
  const recipient = m.recipient?.id;
  if (!sender || !recipient) return null;
  const ts = Number(m.timestamp);
  const sentAt = Number.isFinite(ts) && ts > 0 ? new Date(ts < 1e12 ? ts * 1000 : ts) : new Date();
  if (m.message) {
    const msg = m.message;
    if (!msg.mid) return null;
    const echo = !!msg.is_echo || sender === entryId;
    const attachments = (msg.attachments ?? []).map((a) => ({ type: a.type ?? "file", url: a.payload?.url ?? null }));
    const text = msg.text ?? (msg.is_unsupported ? "(A message type Outlly can't show yet. Open it in the app.)" : "");
    return {
      platform,
      accountPlatformId: entryId,
      personId: echo ? recipient : sender,
      mid: msg.mid,
      direction: echo ? "out" : "in",
      text,
      attachments,
      sentAt,
      deleted: !!msg.is_deleted,
    };
  }
  // A tap on a quick-reply or ice-breaker button reads like a message from the person.
  if (m.postback?.mid) return { platform, accountPlatformId: entryId, personId: sender, mid: m.postback.mid, direction: "in", text: m.postback.title ?? m.postback.payload ?? "", attachments: [], sentAt };
  return null; // reads, reactions, typing: nothing to store
}

/** Flatten a webhook body into message events. Unknown shapes are ignored, never thrown on. */
export function parseWebhook(body: unknown): DmEvent[] {
  const b = body as { object?: string; entry?: Entry[] } | null;
  const platform: DmPlatform | null = b?.object === "instagram" ? "instagram" : b?.object === "page" ? "facebook" : null;
  if (!platform || !Array.isArray(b?.entry)) return [];
  const out: DmEvent[] = [];
  for (const e of b!.entry) {
    if (!e?.id) continue;
    for (const m of e.messaging ?? []) {
      const ev = one(platform, String(e.id), m);
      if (ev) out.push(ev);
    }
    // The dashboard's "Test" button sends the same message inside changes[].value.
    for (const c of e.changes ?? []) {
      if (c?.field !== "messages" || !c.value) continue;
      const ev = one(platform, String(e.id), c.value);
      if (ev) out.push(ev);
    }
  }
  return out;
}

/** Meta's signed_request (data deletion / deauthorize callbacks): base64url(sig).base64url(json), HMAC-SHA256. */
export function parseSignedRequest(signed: string | null, secrets: string[]): { user_id?: string; algorithm?: string } | null {
  if (!signed || !signed.includes(".")) return null;
  const [sig, payload] = signed.split(".", 2);
  const got = Buffer.from(sig.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const ok = secrets.filter(Boolean).some((s) => {
    const want = createHmac("sha256", s).update(payload).digest();
    return want.length === got.length && timingSafeEqual(want, got);
  });
  if (!ok) return null;
  try {
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return data?.algorithm && String(data.algorithm).toUpperCase() !== "HMAC-SHA256" ? null : data;
  } catch {
    return null;
  }
}
