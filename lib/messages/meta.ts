import "server-only";
import { httpFailure, type AccountContext } from "../social/types";

/**
 * Direct messages through Meta (1031). Two APIs, one shape:
 *  - Instagram API with Instagram Login (graph.instagram.com), user token, permission instagram_business_manage_messages.
 *  - Messenger Platform for Pages (graph.facebook.com), Page token, permissions pages_messaging + pages_manage_metadata.
 * Webhooks are the main feed (see lib/messages/webhook.ts); the conversations API backfills the last messages
 * of recent threads when the creator presses Refresh, or right after connecting.
 */
export type DmPlatform = "instagram" | "facebook";
export const DM_PLATFORMS: DmPlatform[] = ["instagram", "facebook"];
export const isDmPlatform = (p: string): p is DmPlatform => p === "instagram" || p === "facebook";

/** Meta's standard messaging window: a business may answer for 24 hours after the person's last message. */
export const REPLY_WINDOW_MS = 24 * 3600_000;
/** Instagram caps a text message at 1000 characters; Messenger allows 2000. One limit keeps the composer honest. */
export const DM_MAX_CHARS = 1000;

const IG = "https://graph.instagram.com/v21.0";
const FB = "https://graph.facebook.com/v21.0";
const T = () => AbortSignal.timeout(12_000);

export interface RemoteMessage {
  mid: string;
  fromId: string;
  toId: string;
  text: string;
  attachments: { type: string; url: string | null }[];
  sentAt: Date;
}
export interface RemoteThread {
  conversationId: string;
  participantId: string;
  participantName: string | null;
  participantHandle: string | null;
  updatedAt: Date;
  messages: RemoteMessage[];
}
export interface Profile {
  name: string | null;
  handle: string | null;
  avatar: string | null;
}

type GMsg = { id: string; created_time?: string; message?: string; from?: { id: string; username?: string; name?: string }; to?: { data?: { id: string; username?: string; name?: string }[] }; attachments?: { data?: GAtt[] } };
type GAtt = { mime_type?: string; image_data?: { url?: string }; video_data?: { url?: string }; file_url?: string; name?: string };
type GConv = { id: string; updated_time?: string; participants?: { data?: { id: string; username?: string; name?: string }[] }; messages?: { data?: GMsg[] } };

function attachmentsOf(m: GMsg) {
  return (m.attachments?.data ?? []).map((a) => ({
    type: a.mime_type?.split("/")[0] ?? (a.image_data ? "image" : a.video_data ? "video" : "file"),
    url: a.image_data?.url ?? a.video_data?.url ?? a.file_url ?? null,
  }));
}

/** Map one conversation; `selfId` is our account (IG professional account id or Page id). */
export function mapConversation(c: GConv, selfId: string): RemoteThread | null {
  const other = (c.participants?.data ?? []).find((p) => p.id !== selfId);
  if (!other) return null;
  const messages = (c.messages?.data ?? []).map<RemoteMessage>((m) => ({
    mid: m.id,
    fromId: m.from?.id ?? "",
    toId: m.to?.data?.[0]?.id ?? "",
    text: m.message ?? "",
    attachments: attachmentsOf(m),
    sentAt: m.created_time ? new Date(m.created_time) : new Date(),
  }));
  return {
    conversationId: c.id,
    participantId: other.id,
    participantName: other.name ?? null,
    participantHandle: other.username ? `@${other.username}` : null,
    updatedAt: c.updated_time ? new Date(c.updated_time) : messages[0]?.sentAt ?? new Date(),
    messages,
  };
}

const MSG_FIELDS = "messages.limit(20){id,created_time,message,from,to,attachments}";

/** The most recent conversations with their last 20 messages (Meta only returns details for the newest 20). */
export async function listConversations(platform: DmPlatform, acct: AccountContext, limit = 20): Promise<RemoteThread[]> {
  const tok = encodeURIComponent(acct.accessToken);
  const url =
    platform === "instagram"
      ? `${IG}/me/conversations?platform=instagram&fields=${encodeURIComponent(`id,updated_time,participants,${MSG_FIELDS}`)}&limit=${limit}&access_token=${tok}`
      : `${FB}/${acct.platformUserId}/conversations?platform=messenger&fields=${encodeURIComponent(`id,updated_time,participants,${MSG_FIELDS}`)}&limit=${limit}&access_token=${tok}`;
  const r = await fetch(url, { signal: T(), cache: "no-store" });
  if (!r.ok) throw await httpFailure(r, `${platform} conversations`);
  const data = ((await r.json()) as { data?: GConv[] }).data ?? [];
  return data.map((c) => mapConversation(c, acct.platformUserId)).filter((x): x is RemoteThread => !!x);
}

/** Name, handle and picture of the person, through the platform's user profile API. Best effort. */
export async function fetchProfile(platform: DmPlatform, acct: AccountContext, personId: string): Promise<Profile | null> {
  const tok = encodeURIComponent(acct.accessToken);
  const url = platform === "instagram" ? `${IG}/${personId}?fields=name,username,profile_pic&access_token=${tok}` : `${FB}/${personId}?fields=first_name,last_name,profile_pic&access_token=${tok}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4_000), cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { name?: string; username?: string; profile_pic?: string; first_name?: string; last_name?: string };
    const name = j.name ?? ([j.first_name, j.last_name].filter(Boolean).join(" ") || null);
    return { name, handle: j.username ? `@${j.username}` : null, avatar: j.profile_pic ?? null };
  } catch {
    return null;
  }
}

/** The person last wrote more than 24 hours ago, so Meta refuses a normal reply. */
export class WindowClosedError extends Error {
  constructor(public technical: string) {
    super("WINDOW_CLOSED");
  }
}

/** Meta's answers when the 24-hour window has closed (code 10 / subcode 2018278, or code 551 on Instagram). */
export function isWindowClosed(body: string) {
  return /2018278|"code"\s*:\s*551\b|outside of allowed window|outside the allowed window/i.test(body);
}

/** Send a text reply. Returns the platform's message id. */
export async function sendText(platform: DmPlatform, acct: AccountContext, recipientId: string, text: string): Promise<{ mid: string }> {
  const url = platform === "instagram" ? `${IG}/me/messages` : `${FB}/${acct.platformUserId}/messages`;
  const body = platform === "instagram" ? { recipient: { id: recipientId }, message: { text } } : { recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text } };
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${acct.accessToken}` },
    body: JSON.stringify(body),
    signal: T(),
  });
  if (!r.ok) {
    const raw = await r.clone().text().catch(() => "");
    if (isWindowClosed(raw)) throw new WindowClosedError(`${platform} send: HTTP ${r.status}\n${raw.slice(0, 2000)}`);
    throw await httpFailure(r, `${platform} send message`);
  }
  const j = (await r.json()) as { message_id?: string };
  return { mid: j.message_id ?? `sent-${Date.now()}` };
}

/**
 * Ask Meta to deliver this account's messages to our webhook. Instagram: the professional account
 * subscribes with its own token. Facebook: the Page subscribes with its Page token (needs pages_manage_metadata).
 */
export async function subscribeMessaging(platform: DmPlatform, acct: AccountContext): Promise<void> {
  const url =
    platform === "instagram"
      ? `${IG}/me/subscribed_apps?subscribed_fields=messages&access_token=${encodeURIComponent(acct.accessToken)}`
      : `${FB}/${acct.platformUserId}/subscribed_apps?subscribed_fields=messages,message_echoes&access_token=${encodeURIComponent(acct.accessToken)}`;
  const r = await fetch(url, { method: "POST", signal: T() });
  if (!r.ok) throw await httpFailure(r, `${platform} subscribe webhooks`);
}
