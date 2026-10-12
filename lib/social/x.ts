import { creds } from "./keys";
import { commonMediaChecks, httpFailure, type AccountContext, type CommentTarget, type PlatformComment, type SocialPublisher, type PublishContext, type RemoteState } from "./types";
import { formPost, newState, pkce } from "./oauth";

// X API v2: OAuth 2.0 PKCE, chunked media upload (initialize → append → finalize → status), then POST /2/tweets.
const API = "https://api.x.com/2";
const CHUNK = 4 * 1024 * 1024;

function basic() {
  return "Basic " + Buffer.from(`${creds("x").clientId}:${creds("x").clientSecret}`).toString("base64");
}

export class XPublisher implements SocialPublisher {
  readonly platform = "x" as const;

  async connect(redirectUri: string) {
    const state = newState();
    const { verifier, challenge } = pkce();
    const u = new URL("https://x.com/i/oauth2/authorize");
    u.search = new URLSearchParams({
      response_type: "code",
      client_id: creds("x").clientId,
      redirect_uri: redirectUri,
      scope: "tweet.read tweet.write users.read media.write offline.access",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    return { url: u.toString(), state, codeVerifier: verifier };
  }

  async completeConnect(code: string, redirectUri: string, codeVerifier?: string) {
    const t = await formPost(
      `${API}/oauth2/token`,
      { code, grant_type: "authorization_code", redirect_uri: redirectUri, code_verifier: codeVerifier ?? "" },
      { authorization: basic() },
    );
    if (!t.ok) throw await httpFailure(t, "x token exchange");
    const tok = (await t.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    const me = await fetch(`${API}/users/me?user.fields=profile_image_url`, { headers: { authorization: `Bearer ${tok.access_token}` } });
    if (!me.ok) throw await httpFailure(me, "x profile");
    const u = ((await me.json()) as { data: { id: string; username: string; name: string; profile_image_url?: string } }).data;
    return {
      platformUserId: u.id,
      username: `@${u.username}`,
      displayName: u.name,
      avatar: u.profile_image_url,
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt: new Date(Date.now() + tok.expires_in * 1000),
    };
  }

  async refreshToken(account: { refreshToken?: string | null }) {
    const r = await formPost(
      `${API}/oauth2/token`,
      { grant_type: "refresh_token", refresh_token: account.refreshToken ?? "" },
      { authorization: basic() },
    );
    if (!r.ok) throw await httpFailure(r, "x refresh");
    const j = (await r.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: new Date(Date.now() + j.expires_in * 1000) };
  }

  validateMedia(m: Parameters<SocialPublisher["validateMedia"]>[0]) {
    return commonMediaChecks(m, { name: "X", maxDuration: 140, maxBytes: 512e6 });
  }

  async upload(ctx: PublishContext) {
    const auth = { authorization: `Bearer ${ctx.account.accessToken}` };
    const init = await fetch(`${API}/media/upload/initialize`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ media_type: ctx.media.mimeType, total_bytes: ctx.media.size, media_category: "tweet_video" }),
    });
    if (!init.ok) throw await httpFailure(init, "x media initialize");
    const id = ((await init.json()) as { data: { id: string } }).data.id;
    const bytes = await ctx.media.readAll();
    for (let i = 0, seg = 0; i < bytes.length; i += CHUNK, seg++) {
      const fd = new FormData();
      fd.append("segment_index", String(seg));
      fd.append("media", new Blob([bytes.subarray(i, i + CHUNK)]));
      const a = await fetch(`${API}/media/upload/${id}/append`, { method: "POST", headers: auth, body: fd });
      if (!a.ok) throw await httpFailure(a, `x media append #${seg}`);
    }
    const fin = await fetch(`${API}/media/upload/${id}/finalize`, { method: "POST", headers: auth });
    if (!fin.ok) throw await httpFailure(fin, "x media finalize");
    return id;
  }

  async publish(ctx: PublishContext, mediaId: string): Promise<RemoteState> {
    const s = await this.mediaState(ctx, mediaId);
    if (s === "failed") return { state: "failed", code: "MEDIA_REJECTED", message: "X could not process the video" };
    if (s !== "succeeded") return { state: "processing", ref: mediaId };
    return this.tweet(ctx, mediaId);
  }

  async getStatus(ctx: PublishContext, ref: string) {
    return this.publish(ctx, ref);
  }

  private async mediaState(ctx: PublishContext, id: string) {
    const r = await fetch(`${API}/media/upload?command=STATUS&media_id=${id}`, {
      headers: { authorization: `Bearer ${ctx.account.accessToken}` },
    });
    if (!r.ok) throw await httpFailure(r, "x media status");
    const j = (await r.json()) as { data?: { processing_info?: { state: string } } };
    return j.data?.processing_info?.state ?? "succeeded";
  }

  private async tweet(ctx: PublishContext, mediaId: string): Promise<RemoteState> {
    const r = await fetch(`${API}/tweets`, {
      method: "POST",
      headers: { authorization: `Bearer ${ctx.account.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ text: ctx.content.caption ?? "", media: { media_ids: [mediaId] } }),
    });
    if (!r.ok) throw await httpFailure(r, "x create post");
    const id = ((await r.json()) as { data: { id: string } }).data.id;
    return { state: "published", platformPostId: id, url: `https://x.com/${ctx.account.username.replace("@", "")}/status/${id}` };
  }

  /** A post carrying our media id already exists on the timeline -> that's ours. Media keys look like "7_<media id>". */
  async findExisting(ctx: PublishContext, hint: { since: Date; uploadRef?: string | null }) {
    if (!hint.uploadRef) return null;
    const q = new URLSearchParams({ max_results: "10", "tweet.fields": "attachments,created_at", expansions: "attachments.media_keys", start_time: hint.since.toISOString() });
    const r = await fetch(`${API}/users/${ctx.account.platformUserId}/tweets?${q}`, { headers: { authorization: `Bearer ${ctx.account.accessToken}` } });
    if (!r.ok) throw await httpFailure(r, "x timeline lookup");
    const j = (await r.json()) as { data?: { id: string; attachments?: { media_keys?: string[] } }[] };
    const hit = j.data?.find((t) => t.attachments?.media_keys?.some((k) => k.endsWith(`_${hint.uploadRef}`)));
    return hit ? { platformPostId: hit.id, url: `https://x.com/${ctx.account.username.replace("@", "")}/status/${hit.id}` } : null;
  }

  /**
   * Replies are tweets sharing the original tweet's conversation_id. Recent search needs a paid
   * (Basic+) tier, so a 403 here means "your X plan doesn't include this", not "reconnect".
   */
  async listComments(target: CommentTarget, account: AccountContext): Promise<PlatformComment[]> {
    const q = new URLSearchParams({
      query: `conversation_id:${target.platformPostId}`,
      max_results: "50",
      "tweet.fields": "created_at,author_id,in_reply_to_user_id,conversation_id,public_metrics",
      expansions: "author_id",
    });
    const r = await fetch(`${API}/tweets/search/recent?${q}`, { headers: { authorization: `Bearer ${account.accessToken}` } });
    if (!r.ok) throw await httpFailure(r, "x conversation search");
    const j = (await r.json()) as {
      data?: { id: string; text: string; created_at?: string; author_id?: string; public_metrics?: { like_count?: number } }[];
      includes?: { users?: { id: string; username: string; name?: string }[] };
    };
    const names = new Map((j.includes?.users ?? []).map((u) => [u.id, `@${u.username}`]));
    return (j.data ?? [])
      .filter((t) => t.id !== target.platformPostId)
      .map((t) => ({
        id: t.id,
        text: t.text,
        authorName: (t.author_id && names.get(t.author_id)) || "Someone on X",
        createdAt: t.created_at ?? new Date().toISOString(),
        likeCount: t.public_metrics?.like_count,
        parentId: target.platformPostId,
      }));
  }

  async replyToComment(account: AccountContext, commentId: string, text: string): Promise<PlatformComment> {
    const r = await fetch(`${API}/tweets`, {
      method: "POST",
      headers: { authorization: `Bearer ${account.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: commentId } }),
    });
    if (!r.ok) throw await httpFailure(r, "x reply");
    const id = ((await r.json()) as { data: { id: string } }).data.id;
    return { id, text, authorName: account.username, createdAt: new Date().toISOString(), parentId: commentId };
  }

  async delete(account: { accessToken: string }, id: string) {
    const r = await fetch(`${API}/tweets/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${account.accessToken}` } });
    if (!r.ok && r.status !== 404) throw await httpFailure(r, "x delete");
  }
}
