import type { ErrorCode, Platform } from "../domain";

export interface OAuthStart {
  url: string;
  state: string;
  codeVerifier?: string;
}

export interface ConnectedProfile {
  platformUserId: string;
  username: string;
  displayName?: string;
  avatar?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
  /** Set when the person unticked a permission Outlly asked for (1031: Instagram messages). Not stored. */
  declined?: string[];
}

/** Decrypted account handed to a publisher. Exists only inside workers, never serialised to the client. */
export interface AccountContext {
  id: string;
  platformUserId: string;
  username: string;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
}

export interface MediaContext {
  id: string;
  mimeType: string;
  size: number;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  /** Absolute signed URL a platform can fetch (Instagram pulls by URL). */
  publicUrl: () => Promise<string>;
  /** Stream bytes (YouTube / X push uploads). */
  open: () => Promise<{ stream: NodeJS.ReadableStream; size: number }>;
  readAll: () => Promise<Buffer>;
}

export interface TargetContent {
  title?: string | null;
  caption?: string | null;
  description?: string | null;
  hashtags?: string | null;
}

export interface PublishContext {
  account: AccountContext;
  media: MediaContext;
  content: TargetContent;
  /** Mock-only knob to rehearse failure UX. Real publishers ignore it. */
  simulate?: SimulationMode;
  attempt: number;
  /** Persist an intermediate handle (e.g. a resumable upload session) so a crash can resume instead of re-uploading. */
  checkpoint?: (ref: string) => Promise<void>;
  /** Handle saved by a previous checkpoint, if any. */
  resumeRef?: string | null;
}

export type SimulationMode = "realistic" | "smooth" | "instagram-reconnect" | "youtube-flaky" | "x-rejects";

export type RemoteState =
  | { state: "processing"; ref: string }
  | { state: "published"; platformPostId: string; url?: string }
  | { state: "failed"; code: ErrorCode; message: string };

export interface MediaIssue {
  level: "error" | "warning";
  message: string;
}

export class PublisherError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public technical?: string,
    public retryable = code === "NETWORK" || code === "RATE_LIMITED" || code === "PLATFORM_DOWN",
  ) {
    super(message);
  }
  /** How long the platform asked us to wait before trying again (Retry-After and friends), when it said. */
  retryAfterMs?: number;
}

/**
 * The platform's own "come back in N" hint: Retry-After (seconds or an HTTP date), X's x-rate-limit-reset
 * (epoch seconds), or Meta's estimated_time_to_regain_access (minutes) in its usage headers.
 */
export function retryAfterMs(h: Headers, now = Date.now()): number | undefined {
  const ra = h.get("retry-after")?.trim();
  if (ra) {
    if (/^\d+(\.\d+)?$/.test(ra)) return Math.round(Number(ra) * 1000);
    const at = Date.parse(ra);
    if (!Number.isNaN(at)) return Math.max(0, at - now);
  }
  const reset = h.get("x-rate-limit-reset")?.trim();
  // Epoch seconds today; a 13-digit value is milliseconds, so it never turns into a wait of decades.
  if (reset && /^\d{9,}$/.test(reset)) return Math.max(0, (reset.length >= 13 ? Number(reset) : Number(reset) * 1000) - now);
  const usage = `${h.get("x-business-use-case-usage") ?? ""} ${h.get("x-app-usage") ?? ""} ${h.get("x-ad-account-usage") ?? ""}`;
  const mins = [...usage.matchAll(/estimated_time_to_regain_access"?\s*:\s*(\d+)/g)].map((m) => Number(m[1]));
  if (mins.length) return Math.max(...mins) * 60_000;
  return undefined;
}

const withWait = (e: PublisherError, res: Response) => {
  const ms = retryAfterMs(res.headers);
  if (ms !== undefined) e.retryAfterMs = ms;
  return e;
};

/** The published post a comment thread hangs off. */
export interface CommentTarget {
  platformPostId: string;
  /** Platform-specific extra the publisher needs (X needs the conversation id, which is the tweet id). */
  practice?: boolean;
}

export interface PlatformComment {
  id: string;
  text: string;
  authorName: string;
  createdAt: string;
  likeCount?: number;
  /** Set on replies so the UI can nest them under their parent. */
  parentId?: string | null;
  replies?: PlatformComment[];
  /** Rehearsal data from MockPublisher. Never shown as if it came from a real audience. */
  practice?: boolean;
}

export interface SocialPublisher {
  readonly platform: Platform;
  /** Build the OAuth 2.0 authorize URL. Passwords never touch our servers. */
  connect(redirectUri: string): Promise<OAuthStart>;
  /** Exchange the OAuth code for tokens + profile. */
  completeConnect(code: string, redirectUri: string, codeVerifier?: string): Promise<ConnectedProfile>;
  refreshToken(account: AccountContext): Promise<Pick<ConnectedProfile, "accessToken" | "refreshToken" | "expiresAt">>;
  validateMedia(media: Pick<MediaContext, "mimeType" | "size" | "duration" | "width" | "height">): MediaIssue[];
  /** Move bytes to the platform. Returns an opaque upload handle. */
  upload(ctx: PublishContext): Promise<string>;
  /** Turn an upload handle into a post. May return `processing` → poll getStatus. */
  publish(ctx: PublishContext, uploadRef: string): Promise<RemoteState>;
  getStatus(ctx: PublishContext, ref: string): Promise<RemoteState>;
  delete(account: AccountContext, platformPostId: string): Promise<void>;
  /** Hide without deleting (YouTube: private) or show again. Optional: only platforms whose API allows it. */
  setVisibility?(account: AccountContext, platformPostId: string, visible: boolean): Promise<void>;
  /**
   * Duplicate guard. Called before retrying a step whose outcome is unknown (timeout after we asked the
   * platform to publish). Returns the post if it already went live, so we record it instead of posting twice.
   */
  findExisting?(ctx: PublishContext, hint: { since: Date; uploadRef?: string | null }): Promise<{ platformPostId: string; url?: string } | null>;
  /** Comments on a published post, newest first. Optional: a platform without the permission simply omits it. */
  listComments?(target: CommentTarget, account: AccountContext): Promise<PlatformComment[]>;
  replyToComment?(account: AccountContext, commentId: string, text: string): Promise<PlatformComment>;
  /** The creator's own first comment on their just-published post (a reply to it on X). */
  postComment?(account: AccountContext, platformPostId: string, text: string): Promise<{ id: string }>;
}

/** fetch() itself failing (DNS, reset, timeout) means we don't know what the platform did. */
export function asPublisherError(e: unknown): PublisherError {
  if (e instanceof PublisherError) return e;
  if (e instanceof Error && (e.name === "TypeError" || e.name === "AbortError" || /fetch failed|ECONN|ETIMEDOUT|socket/i.test(e.message)))
    return new PublisherError("NETWORK", "Connection problem", e.message);
  return new PublisherError("UNKNOWN", "Unexpected", e instanceof Error ? (e.stack ?? e.message) : String(e), false);
}

/** Map an HTTP failure to a human-safe code while keeping the raw detail for the disclosure panel. */
export async function httpFailure(res: Response, what: string): Promise<PublisherError> {
  const body = await res.text().catch(() => "");
  const technical = `${what}: HTTP ${res.status} ${res.statusText}\n${body.slice(0, 2000)}`;
  if (res.status === 403 && /duplicate/i.test(body)) return new PublisherError("DUPLICATE", "Already posted", technical, false);
  // Meta throttles with HTTP 400 (or 403) and an error code, not 429: 4 app, 17 user, 32 page, 613 call-rate,
  // 80001-80014 business use case. Without this they fell through to "Media rejected" and failed for good,
  // and (body type "OAuthException") a 403 one even flagged the account for reconnection. So: before the 401/403 rules.
  const meta = /fbtrace_id|"type"\s*:\s*"(OAuthException|GraphMethodException)"/.test(body); // X reuses small codes (32 = bad auth)
  if ((res.status === 400 || res.status === 403) && meta && /"code"\s*:\s*(4|17|32|613|8000[1-9]|8001[0-4])\b/.test(body))
    return withWait(new PublisherError("RATE_LIMITED", "Rate limited", technical), res);
  // Meta marks a temporary fault on its side with is_transient (often code 1 or 2 on a 400/500).
  if (meta && /"is_transient"\s*:\s*true/.test(body)) return withWait(new PublisherError("PLATFORM_DOWN", "Platform unavailable", technical), res);
  if (res.status === 401) return new PublisherError("AUTH_EXPIRED", "Authorization expired", technical, false);
  if (res.status === 403) {
    // 403 is usually a permission/tier problem, not an expired token. Only treat OAuth-ish bodies as reconnect.
    if (/token|oauth|expired|revoked|unauthori[sz]ed/i.test(body)) return new PublisherError("AUTH_EXPIRED", "Authorization expired", technical, false);
    return new PublisherError("FORBIDDEN", "Not permitted", technical, false);
  }
  // Meta's Graph API answers 400 for token and permission problems too; its error code says which.
  if (res.status === 400 && /"code"\s*:\s*(190|102)\b/.test(body)) return new PublisherError("AUTH_EXPIRED", "Authorization expired", technical, false);
  if (res.status === 400 && /"code"\s*:\s*(10|200|294)\b/.test(body)) return new PublisherError("FORBIDDEN", "Not permitted", technical, false);
  if (res.status === 429) return withWait(new PublisherError("RATE_LIMITED", "Rate limited", technical), res);
  if (res.status >= 500) return withWait(new PublisherError("PLATFORM_DOWN", "Platform unavailable", technical), res);
  if (res.status === 400 || res.status === 413 || res.status === 422)
    return new PublisherError("MEDIA_REJECTED", "Media rejected", technical, false);
  return new PublisherError("UNKNOWN", "Unexpected response", technical, false);
}

export function commonMediaChecks(
  m: Pick<MediaContext, "mimeType" | "size" | "duration" | "width" | "height">,
  rules: { maxDuration: number; maxBytes: number; preferVertical?: boolean; name: string },
): MediaIssue[] {
  const out: MediaIssue[] = [];
  if (!["video/mp4", "video/quicktime"].includes(m.mimeType)) out.push({ level: "error", message: `${rules.name} needs an MP4 or MOV.` });
  if (m.size > rules.maxBytes) out.push({ level: "error", message: `${rules.name} caps files at ${Math.round(rules.maxBytes / 1e6)} MB.` });
  if (m.duration && m.duration > rules.maxDuration)
    out.push({ level: "error", message: `${rules.name} allows up to ${Math.round(rules.maxDuration)}s here. Yours is ${Math.round(m.duration)}s.` });
  if (rules.preferVertical && m.width && m.height && m.width >= m.height)
    out.push({ level: "warning", message: `${rules.name} looks best vertical (9:16). This one will get letterboxed.` });
  return out;
}
