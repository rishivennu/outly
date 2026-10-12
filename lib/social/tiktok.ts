import { commonMediaChecks, httpFailure, PublisherError, type SocialPublisher, type PublishContext, type RemoteState } from "./types";
import { formPost, newState } from "./oauth";
import { creds } from "./keys";

// TikTok Content Posting API v2 (Direct Post): init with FILE_UPLOAD -> PUT the bytes -> poll status/fetch.
// Unaudited apps may only post SELF_ONLY; we pick the most public level TikTok offers this creator.
const API = "https://open.tiktokapis.com/v2";
const SINGLE_MAX = 64 * 1024 * 1024;
const CHUNK = 10 * 1024 * 1024;

const bearer = (t: string) => ({ authorization: `Bearer ${t}`, "content-type": "application/json; charset=UTF-8" });

export class TikTokPublisher implements SocialPublisher {
  readonly platform = "tiktok" as const;

  async connect(redirectUri: string) {
    const state = newState();
    const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
    u.search = new URLSearchParams({
      client_key: creds("tiktok").clientId,
      scope: "user.info.basic,user.info.profile,video.publish,video.upload",
      response_type: "code",
      redirect_uri: redirectUri,
      state,
    }).toString();
    return { url: u.toString(), state };
  }

  async completeConnect(code: string, redirectUri: string) {
    const t = await formPost(`${API}/oauth/token/`, { client_key: creds("tiktok").clientId, client_secret: creds("tiktok").clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri });
    if (!t.ok) throw await httpFailure(t, "tiktok token exchange");
    const tok = (await t.json()) as { access_token: string; refresh_token: string; expires_in: number; open_id: string; error?: string; error_description?: string };
    if (!tok.access_token) throw new PublisherError("AUTH_EXPIRED", "TikTok refused the sign-in", tok.error_description ?? tok.error ?? "no access_token", false);
    const me = await fetch(`${API}/user/info/?fields=open_id,avatar_url,display_name,username`, { headers: { authorization: `Bearer ${tok.access_token}` } });
    if (!me.ok) throw await httpFailure(me, "tiktok profile");
    const u = ((await me.json()) as { data?: { user?: { open_id: string; display_name?: string; username?: string; avatar_url?: string } } }).data?.user;
    return {
      platformUserId: u?.open_id ?? tok.open_id,
      username: u?.username ? `@${u.username}` : (u?.display_name ?? "TikTok"),
      displayName: u?.display_name,
      avatar: u?.avatar_url,
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt: new Date(Date.now() + tok.expires_in * 1000),
    };
  }

  async refreshToken(account: { refreshToken?: string | null }) {
    const r = await formPost(`${API}/oauth/token/`, { client_key: creds("tiktok").clientId, client_secret: creds("tiktok").clientSecret, grant_type: "refresh_token", refresh_token: account.refreshToken ?? "" });
    if (!r.ok) throw await httpFailure(r, "tiktok refresh");
    const j = (await r.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
    if (!j.access_token) throw new PublisherError("AUTH_EXPIRED", "TikTok sign-in expired", j.error_description ?? "refresh failed", false);
    return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: new Date(Date.now() + (j.expires_in ?? 86400) * 1000) };
  }

  validateMedia(m: Parameters<SocialPublisher["validateMedia"]>[0]) {
    return commonMediaChecks(m, { name: "TikTok", maxDuration: 600, maxBytes: 4e9, preferVertical: true });
  }

  /** The privacy levels this creator may use right now (TikTok decides, per account). */
  private async privacy(token: string) {
    const r = await fetch(`${API}/post/publish/creator_info/query/`, { method: "POST", headers: bearer(token), body: "{}" });
    if (!r.ok) throw await httpFailure(r, "tiktok creator info");
    const opts = ((await r.json()) as { data?: { privacy_level_options?: string[] } }).data?.privacy_level_options ?? [];
    return opts.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : (opts[0] ?? "SELF_ONLY");
  }

  async upload(ctx: PublishContext) {
    if (ctx.resumeRef) return ctx.resumeRef;
    const size = ctx.media.size;
    const single = size <= SINGLE_MAX;
    const chunk = single ? size : CHUNK;
    const count = single ? 1 : Math.floor(size / CHUNK);
    const title = [ctx.content.caption, ctx.content.hashtags].filter(Boolean).join(" ").slice(0, 2200);
    const init = await fetch(`${API}/post/publish/video/init/`, {
      method: "POST",
      headers: bearer(ctx.account.accessToken),
      body: JSON.stringify({
        post_info: { title, privacy_level: await this.privacy(ctx.account.accessToken), disable_comment: false, disable_duet: false, disable_stitch: false },
        source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunk, total_chunk_count: count },
      }),
    });
    if (!init.ok) throw await httpFailure(init, "tiktok init");
    const d = ((await init.json()) as { data: { publish_id: string; upload_url: string } }).data;
    const bytes = await ctx.media.readAll();
    for (let i = 0; i < count; i++) {
      const start = i * chunk;
      const end = i === count - 1 ? size : start + chunk; // last chunk carries the remainder
      const put = await fetch(d.upload_url, {
        method: "PUT",
        headers: { "content-type": ctx.media.mimeType, "content-length": String(end - start), "content-range": `bytes ${start}-${end - 1}/${size}` },
        body: new Uint8Array(bytes.subarray(start, end)),
      });
      if (!put.ok && put.status !== 206) throw await httpFailure(put, "tiktok upload chunk");
    }
    await ctx.checkpoint?.(d.publish_id);
    return d.publish_id;
  }

  async publish(ctx: PublishContext, publishId: string) {
    return this.getStatus(ctx, publishId);
  }

  async getStatus(ctx: PublishContext, publishId: string): Promise<RemoteState> {
    const r = await fetch(`${API}/post/publish/status/fetch/`, { method: "POST", headers: bearer(ctx.account.accessToken), body: JSON.stringify({ publish_id: publishId }) });
    if (!r.ok) throw await httpFailure(r, "tiktok status");
    const d = ((await r.json()) as { data?: { status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] } }).data;
    if (!d) return { state: "processing", ref: publishId };
    if (d.status === "FAILED") return { state: "failed", code: "MEDIA_REJECTED", message: d.fail_reason ?? "TikTok rejected the video" };
    if (d.status === "PUBLISH_COMPLETE") {
      const id = d.publicaly_available_post_id?.[0];
      const handle = ctx.account.username.startsWith("@") ? ctx.account.username : null;
      // Private (SELF_ONLY) posts have no public id; record the publish id so the post still counts as sent.
      return { state: "published", platformPostId: id ? String(id) : publishId, url: id && handle ? `https://www.tiktok.com/${handle}/video/${id}` : undefined };
    }
    return { state: "processing", ref: publishId };
  }

  async delete() {
    throw new PublisherError("FORBIDDEN", "TikTok doesn't let apps delete videos. Remove it in the TikTok app.", undefined, false);
  }
}
