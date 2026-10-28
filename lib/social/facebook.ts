import { commonMediaChecks, httpFailure, PublisherError, type SocialPublisher, type PublishContext, type RemoteState } from "./types";
import { newState } from "./oauth";
import { creds, dmsOn } from "./keys";

// Facebook Page Reels: video_reels start -> rupload with a hosted file_url -> video_reels finish (PUBLISHED) -> poll status.
// We connect the creator's first Page; its token is derived from a long-lived user token, so it doesn't expire.
const V = "v21.0";
const GRAPH = `https://graph.facebook.com/${V}`;
const FB_BASE_SCOPES = "pages_show_list,pages_read_engagement,pages_manage_posts,publish_video,read_insights";
/** pages_messaging + pages_manage_metadata (1031): read and answer the Page's Messenger conversations, and subscribe the Page to our webhook. */
export const FB_DM_SCOPES = "pages_messaging,pages_manage_metadata";
export const FACEBOOK_SCOPES = `${FB_BASE_SCOPES},${FB_DM_SCOPES}`;
/** Left without the messaging pair when the admin switches DMs off (1031f). */
export const facebookScopes = (dms: boolean) => (dms ? FACEBOOK_SCOPES : FB_BASE_SCOPES);

export class FacebookPublisher implements SocialPublisher {
  readonly platform = "facebook" as const;

  async connect(redirectUri: string) {
    const state = newState();
    const u = new URL(`https://www.facebook.com/${V}/dialog/oauth`);
    u.search = new URLSearchParams({ client_id: creds("facebook").clientId, redirect_uri: redirectUri, state, response_type: "code", scope: facebookScopes(dmsOn("facebook")) }).toString();
    return { url: u.toString(), state };
  }

  async completeConnect(code: string, redirectUri: string) {
    const { clientId, clientSecret } = creds("facebook");
    const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
    const t = await fetch(`${GRAPH}/oauth/access_token?${q({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code })}`);
    if (!t.ok) throw await httpFailure(t, "facebook token exchange");
    const short = ((await t.json()) as { access_token: string }).access_token;
    const l = await fetch(`${GRAPH}/oauth/access_token?${q({ grant_type: "fb_exchange_token", client_id: clientId, client_secret: clientSecret, fb_exchange_token: short })}`);
    if (!l.ok) throw await httpFailure(l, "facebook long-lived exchange");
    const userToken = ((await l.json()) as { access_token: string }).access_token;
    const pages = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token,picture{url}&access_token=${userToken}`);
    if (!pages.ok) throw await httpFailure(pages, "facebook pages");
    const list = ((await pages.json()) as { data?: { id: string; name: string; access_token: string; picture?: { data?: { url?: string } } }[] }).data ?? [];
    const page = list[0];
    if (!page) throw Object.assign(new Error("This Facebook account doesn't manage a Page yet. Reels publish to a Page."), { code: "NO_PAGE" });
    // The person's app-scoped id: Meta's data deletion callback names the user, not the Page (1031).
    const me: { id?: string } = await fetch(`${GRAPH}/me?fields=id&access_token=${userToken}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ id?: string }>) : {}))
      .catch(() => ({}));
    return {
      platformUserId: page.id,
      username: page.name,
      displayName: page.name,
      avatar: page.picture?.data?.url,
      accessToken: page.access_token,
      metadata: { pages: list.map((p) => ({ id: p.id, name: p.name })), ...(me.id ? { metaUserId: me.id } : {}) },
    };
  }

  /** Page tokens from a long-lived user token don't expire; nothing to refresh. */
  async refreshToken(account: { accessToken: string }) {
    return { accessToken: account.accessToken };
  }

  validateMedia(m: Parameters<SocialPublisher["validateMedia"]>[0]) {
    return commonMediaChecks(m, { name: "Facebook Reels", maxDuration: 90, maxBytes: 1e9, preferVertical: true });
  }

  async upload(ctx: PublishContext) {
    if (ctx.resumeRef) return ctx.resumeRef;
    const page = ctx.account.platformUserId;
    const tok = ctx.account.accessToken;
    const start = await fetch(`${GRAPH}/${page}/video_reels`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ upload_phase: "start", access_token: tok }) });
    if (!start.ok) throw await httpFailure(start, "facebook reels start");
    const { video_id } = (await start.json()) as { video_id: string };
    const up = await fetch(`https://rupload.facebook.com/video-upload/${V}/${video_id}`, { method: "POST", headers: { authorization: `OAuth ${tok}`, file_url: await ctx.media.publicUrl() } });
    if (!up.ok) throw await httpFailure(up, "facebook reels upload");
    await ctx.checkpoint?.(video_id);
    return video_id;
  }

  async publish(ctx: PublishContext, videoId: string): Promise<RemoteState> {
    const description = [ctx.content.caption || ctx.content.description, ctx.content.hashtags].filter(Boolean).join("\n\n");
    const r = await fetch(`${GRAPH}/${ctx.account.platformUserId}/video_reels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ upload_phase: "finish", video_id: videoId, video_state: "PUBLISHED", description, title: ctx.content.title ?? undefined, access_token: ctx.account.accessToken }),
    });
    if (!r.ok) throw await httpFailure(r, "facebook reels finish");
    return this.getStatus(ctx, videoId);
  }

  async getStatus(ctx: PublishContext, videoId: string): Promise<RemoteState> {
    const r = await fetch(`${GRAPH}/${videoId}?fields=status,permalink_url&access_token=${ctx.account.accessToken}`);
    if (!r.ok) throw await httpFailure(r, "facebook video status");
    const j = (await r.json()) as { status?: { video_status?: string; publishing_phase?: { status?: string }; processing_phase?: { status?: string; error?: { message?: string } } }; permalink_url?: string };
    if (j.status?.video_status === "error" || j.status?.processing_phase?.status === "error") return { state: "failed", code: "MEDIA_REJECTED", message: j.status?.processing_phase?.error?.message ?? "Facebook couldn't process the video" };
    if (j.status?.publishing_phase?.status === "complete" || j.status?.video_status === "published") {
      const url = j.permalink_url ? (j.permalink_url.startsWith("http") ? j.permalink_url : `https://www.facebook.com${j.permalink_url}`) : undefined;
      return { state: "published", platformPostId: videoId, url };
    }
    return { state: "processing", ref: videoId };
  }

  async delete(account: { accessToken: string }, id: string) {
    const r = await fetch(`${GRAPH}/${id}?access_token=${account.accessToken}`, { method: "DELETE" });
    if (!r.ok) throw await httpFailure(r, "facebook delete");
    // Graph can answer 200 {"success":false}: a refusal, never record it as gone.
    if (((await r.json().catch(() => ({}))) as { success?: boolean }).success === false)
      throw new PublisherError("UNKNOWN", "Facebook didn't delete it", "facebook delete: 200 success=false", false);
  }
}

