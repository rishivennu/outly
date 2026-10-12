import { commonMediaChecks, httpFailure, PublisherError, type SocialPublisher, type PublishContext, type RemoteState } from "./types";
import { formPost, newState } from "./oauth";
import { creds } from "./keys";

// LinkedIn Posts API (versioned REST): videos?action=initializeUpload -> PUT parts (collect ETags) ->
// finalizeUpload -> wait until AVAILABLE -> POST /rest/posts. Posts as the member (w_member_social).
const REST = "https://api.linkedin.com/rest";
const VERSION = "202501";

const h = (token: string, json = true) => ({
  authorization: `Bearer ${token}`,
  "linkedin-version": VERSION,
  "x-restli-protocol-version": "2.0.0",
  ...(json ? { "content-type": "application/json" } : {}),
});

/** LinkedIn "little text": these characters must be escaped or the post is rejected. */
export const escapeLittleText = (s: string) => s.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);

export class LinkedInPublisher implements SocialPublisher {
  readonly platform = "linkedin" as const;

  async connect(redirectUri: string) {
    const state = newState();
    const u = new URL("https://www.linkedin.com/oauth/v2/authorization");
    u.search = new URLSearchParams({ response_type: "code", client_id: creds("linkedin").clientId, redirect_uri: redirectUri, state, scope: "openid profile email w_member_social" }).toString();
    return { url: u.toString(), state };
  }

  async completeConnect(code: string, redirectUri: string) {
    const { clientId, clientSecret } = creds("linkedin");
    const t = await formPost("https://www.linkedin.com/oauth/v2/accessToken", { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret });
    if (!t.ok) throw await httpFailure(t, "linkedin token exchange");
    const tok = (await t.json()) as { access_token: string; expires_in: number; refresh_token?: string };
    const me = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { authorization: `Bearer ${tok.access_token}` } });
    if (!me.ok) throw await httpFailure(me, "linkedin profile");
    const p = (await me.json()) as { sub: string; name?: string; picture?: string; email?: string };
    return { platformUserId: p.sub, username: p.name ?? p.email ?? "LinkedIn member", displayName: p.name, avatar: p.picture, accessToken: tok.access_token, refreshToken: tok.refresh_token, expiresAt: new Date(Date.now() + tok.expires_in * 1000) };
  }

  /** Only LinkedIn partner apps get refresh tokens; everyone else reconnects every 60 days. */
  async refreshToken(account: { refreshToken?: string | null }) {
    if (!account.refreshToken) throw new PublisherError("AUTH_EXPIRED", "LinkedIn sign-in expired", "No refresh token (LinkedIn issues them to partner apps only).", false);
    const { clientId, clientSecret } = creds("linkedin");
    const r = await formPost("https://www.linkedin.com/oauth/v2/accessToken", { grant_type: "refresh_token", refresh_token: account.refreshToken, client_id: clientId, client_secret: clientSecret });
    if (!r.ok) throw await httpFailure(r, "linkedin refresh");
    const j = (await r.json()) as { access_token: string; expires_in: number; refresh_token?: string };
    return { accessToken: j.access_token, refreshToken: j.refresh_token ?? account.refreshToken, expiresAt: new Date(Date.now() + j.expires_in * 1000) };
  }

  validateMedia(m: Parameters<SocialPublisher["validateMedia"]>[0]) {
    return commonMediaChecks(m, { name: "LinkedIn", maxDuration: 600, maxBytes: 5e9 });
  }

  private owner(ctx: PublishContext) {
    return `urn:li:person:${ctx.account.platformUserId}`;
  }

  async upload(ctx: PublishContext) {
    if (ctx.resumeRef) return ctx.resumeRef;
    const tok = ctx.account.accessToken;
    const init = await fetch(`${REST}/videos?action=initializeUpload`, {
      method: "POST",
      headers: h(tok),
      body: JSON.stringify({ initializeUploadRequest: { owner: this.owner(ctx), fileSizeBytes: ctx.media.size, uploadCaptions: false, uploadThumbnail: false } }),
    });
    if (!init.ok) throw await httpFailure(init, "linkedin initializeUpload");
    const v = ((await init.json()) as { value: { video: string; uploadToken?: string; uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[] } }).value;
    const bytes = await ctx.media.readAll();
    const etags: string[] = [];
    for (const part of v.uploadInstructions) {
      const put = await fetch(part.uploadUrl, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(bytes.subarray(part.firstByte, part.lastByte + 1)) });
      if (!put.ok) throw await httpFailure(put, "linkedin upload part");
      etags.push(put.headers.get("etag") ?? "");
    }
    const fin = await fetch(`${REST}/videos?action=finalizeUpload`, { method: "POST", headers: h(tok), body: JSON.stringify({ finalizeUploadRequest: { video: v.video, uploadToken: v.uploadToken ?? "", uploadedPartIds: etags } }) });
    if (!fin.ok) throw await httpFailure(fin, "linkedin finalizeUpload");
    await ctx.checkpoint?.(v.video);
    return v.video;
  }

  async publish(ctx: PublishContext, videoUrn: string) {
    return this.getStatus(ctx, videoUrn);
  }

  async getStatus(ctx: PublishContext, ref: string): Promise<RemoteState> {
    if (ref.startsWith("urn:li:share:") || ref.startsWith("urn:li:ugcPost:")) return { state: "published", platformPostId: ref, url: `https://www.linkedin.com/feed/update/${ref}` };
    const tok = ctx.account.accessToken;
    const s = await fetch(`${REST}/videos/${encodeURIComponent(ref)}`, { headers: h(tok, false) });
    if (!s.ok) throw await httpFailure(s, "linkedin video status");
    const status = ((await s.json()) as { status?: string }).status;
    if (status === "PROCESSING_FAILED") return { state: "failed", code: "MEDIA_REJECTED", message: "LinkedIn couldn't process the video" };
    if (status !== "AVAILABLE") return { state: "processing", ref };
    const text = [ctx.content.caption || ctx.content.description, ctx.content.hashtags].filter(Boolean).join("\n\n").slice(0, 3000);
    const post = await fetch(`${REST}/posts`, {
      method: "POST",
      headers: h(tok),
      body: JSON.stringify({
        author: this.owner(ctx),
        commentary: escapeLittleText(text),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        content: { media: { title: (ctx.content.title ?? "").slice(0, 200) || undefined, id: ref } },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
    });
    if (!post.ok) throw await httpFailure(post, "linkedin create post");
    const urn = post.headers.get("x-restli-id") ?? post.headers.get("x-linkedin-id") ?? "";
    return { state: "published", platformPostId: urn || ref, url: urn ? `https://www.linkedin.com/feed/update/${urn}` : undefined };
  }

  async delete(account: { accessToken: string }, id: string) {
    const r = await fetch(`${REST}/posts/${encodeURIComponent(id)}`, { method: "DELETE", headers: h(account.accessToken, false) });
    if (!r.ok && r.status !== 404) throw await httpFailure(r, "linkedin delete");
  }
}
