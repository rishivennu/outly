import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 1142: the rules of the one-time waitlist announcement, free of the database so tests can pin them.
 * lib/campaigns.ts does the I/O.
 */
export const WAITLIST_UPDATE = {
  id: "outlly_waitlist_update_announcement_2026",
  subject: "You're on the Outlly waitlist! Here's a quick update 🚀",
} as const;

/** Tries per address. Only a timeout, a 429 or a 5xx is retried; the provider saying no (422 bad address) is final. */
export const MAX_ATTEMPTS = 4;
/** Wait before try 2, 3, 4. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];
/** Resend allows 2 requests a second per team, shared with sign-in codes. One campaign email every 600 ms leaves room. */
export const SEND_GAP_MS = 600;
/** A row stuck in "sending" this long means the function died mid-send. The Idempotency-Key makes the retry safe. */
export const STALE_SENDING_MS = 10 * 60_000;

export const normEmail = (e: string) => e.trim().toLowerCase();
const SHAPE = /^[^\s@<>()[\]\\,;:"']+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;
export const validEmail = (e: string) => e.length <= 254 && SHAPE.test(e);

/** Who gets it: valid addresses of people who joined strictly before the cutoff, each address once (oldest row wins). */
export function eligible<T extends { id: string; email: string; createdAt: Date }>(rows: T[], cutoff: Date) {
  const seen = new Set<string>();
  const list: { email: string; waitlistId: string }[] = [];
  let invalid = 0;
  let dupes = 0;
  let late = 0;
  for (const r of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (r.createdAt.getTime() >= cutoff.getTime()) {
      late++;
      continue;
    }
    const e = normEmail(r.email);
    if (!validEmail(e)) {
      invalid++;
      continue;
    }
    if (seen.has(e)) {
      dupes++;
      continue;
    }
    seen.add(e);
    list.push({ email: e, waitlistId: r.id });
  }
  return { list, invalid, dupes, late };
}

export type SendResult = { status: string; error?: string; providerId?: string; code?: number };
export type Outcome = { status: string; error: string | null; providerId?: string | null; sentAt?: Date; nextAt?: Date };

/** What a send means for the recipient row. `attempts` already counts this try. */
export function outcome(r: SendResult, attempts: number, now = new Date()): Outcome {
  if (r.status === "sent") return { status: "accepted", error: null, providerId: r.providerId ?? null, sentAt: now };
  if (r.status === "mocked") return { status: "mocked", error: null, sentAt: now };
  if (r.status === "skipped") return { status: "skipped", error: r.error ?? "Unsubscribed" };
  const transient = !r.code || r.code === 429 || r.code >= 500;
  if (transient && attempts < MAX_ATTEMPTS) return { status: "pending", error: r.error ?? "Send failed", nextAt: new Date(now.getTime() + BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1]) };
  return { status: "failed", error: r.error ?? "Send failed" };
}

/** Rows that went to the provider: the "Sent" number. */
export const SENT = ["accepted", "delivered", "bounced", "complained", "mocked"];

/** A Resend webhook event applied to a row. null = leave it. Delivered never overwrites a bounce or complaint. */
export function applyEvent(cur: string, type: string): string | null {
  if (type === "email.delivered") return cur === "accepted" || cur === "sending" ? "delivered" : null;
  if (type === "email.bounced") return cur === "complained" ? null : "bounced";
  if (type === "email.complained") return "complained";
  if (type === "email.failed") return cur === "delivered" || cur === "bounced" || cur === "complained" ? null : "failed";
  return null;
}

/**
 * Svix signature check (Resend signs webhooks with Svix). Signed text is `${id}.${timestamp}.${body}`, HMAC-SHA256
 * keyed with the base64 part of the whsec_ secret; the header may list several "v1,<sig>" entries. Five minutes of
 * clock skew either way, so a captured request can't be replayed later.
 */
export function verifySvix(secret: string, h: { id: string | null; timestamp: string | null; signature: string | null }, body: string, nowMs = Date.now()) {
  if (!secret || !h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > 300) return false;
  let key: Buffer;
  try {
    key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  } catch {
    return false;
  }
  if (!key.length) return false;
  const want = createHmac("sha256", key).update(`${h.id}.${h.timestamp}.${body}`).digest();
  return h.signature.split(" ").some((part) => {
    const [v, sig] = part.split(",");
    if (v !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === want.length && timingSafeEqual(got, want);
  });
}
