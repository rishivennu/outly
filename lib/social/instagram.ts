import { env } from "../env";
import { commonMediaChecks, httpFailure, PublisherError, type AccountContext, type CommentTarget, type PlatformComment, type SocialPublisher, type PublishContext, type RemoteState } from "./types";
import { formPost, newState } from "./oauth";

// Instagram API with Instagram Login (professional accounts). Reels are published as a container:
//   POST /{ig-user-id}/media (media_type=REELS, video_url) → poll status_code → POST /{ig-user-id}/media_publish
const GRAPH = "https://graph.instagram.com/v21.0";

export class InstagramPublisher implements SocialPublisher {
  readonly platform = "instagram" as const;

  async connect(redirectUri: string) {
    const state = newState();
    const u = new URL("https://www.instagram.com/oauth/authorize");
    u.search = new URLSearchParams({
      client_id: env.INSTAGRAM_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      // instagram_manage_comments is what the inbox needs; without it comment reads return 403.
      scope: "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments",
      state,
    }).toString();
    return { url: u.toString(), state };
  }

  async completeConnect(code: string, redirectUri: string) {
    const short = await formPost("https://api.instagram.com/oauth/access_token", {
      client_id: env.INSTAGRAM_CLIENT_ID,
      client_secret: env.INSTAGRAM_CLIENT_SECRET,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    });
    if (!short.ok) throw await httpFailure(short, "instagram token exchange");
    const s = (await short.json()) as { access_token: string; user_id: string | number };
    const long = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${env.INSTAGRAM_CLIENT_SECRET}&access_token=${s.access_token}`,
    );
    if (!long.ok) throw await httpFailure(long, "instagram long-lived exchange");
    const l = (await long.json()) as { access_token: string; expires_in: number };
    const me = await fetch(`${GRAPH}/me?fields=user_id,username,name,profile_picture_url&access_token=${l.access_token}`);
    if (!me.ok) throw await httpFailure(me, "instagram profile");
    const p = (await me.json()) as { user_id: string; username: string; name?: string; profile_picture_url?: string };
    return {
      platformUserId: String(p.user_id ?? s.user_id),
      username: `@${p.username}`,
      displayName: p.name,
      avatar: p.profile_picture_url,
      accessToken: l.access_token,
      expiresAt: new Date(Date.now() + l.expires_in * 1000),
    };
  }

  /**
   * Connect with a long-lived token generated in the Meta app dashboard. Needs no app secret:
   * the token is checked against /me, then refreshed so we learn its real expiry.
   */
  async connectWithToken(token: string) {
    const me = await fetch(`${GRAPH}/me?fields=user_id,username,name,profile_picture_url,account_type&access_token=${encodeURIComponent(token)}`);
    if (!me.ok) throw await httpFailure(me, "instagram profile");
    const p = (await me.json()) as { user_id: string; username: string; name?: string; profile_picture_url?: string; account_type?: string };
    let accessToken = token;
    let expiresAt: Date | undefined;
    try {
      const r = await this.refreshToken({ accessToken: token });
      accessToken = r.accessToken;
      expiresAt = r.expiresAt;
    } catch {
      // Tokens younger than 24 h can't be refreshed yet; keep the original and leave expiry unknown.
    }
    return {
      platformUserId: String(p.user_id),
      username: `@${p.username}`,
      displayName: p.name,
      avatar: p.profile_picture_url,
      accessToken,
      expiresAt,
      metadata: { connectedWith: "token", accountType: p.account_type },
    };
  }

  async refreshToken(account: { accessToken: string }) {
    const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${account.accessToken}`);
    if (!r.ok) throw await httpFailure(r, "instagram refresh");
    const j = (await r.json()) as { access_token: string; expires_in: number };
    return { accessToken: j.access_token, expiresAt: new Date(Date.now() + j.expires_in * 1000) };
  }

  validateMedia(m: Parameters<SocialPublisher["validateMedia"]>[0]) {
    return commonMediaChecks(m, { name: "Instagram", maxDuration: 900, maxBytes: 300e6, preferVertical: true });
  }

  async upload(ctx: PublishContext) {
    const caption = [ctx.content.caption, ctx.content.hashtags].filter(Boolean).join("\n\n");
    const r = await formPost(`${GRAPH}/${ctx.account.platformUserId}/media`, {
      media_type: "REELS",
      video_url: await ctx.media.publicUrl(),
      caption,
      share_to_feed: "true",
      access_token: ctx.account.accessToken,
    });
    if (!r.ok) throw await httpFailure(r, "instagram create container");
    return ((await r.json()) as { id: string }).id;
  }

  async publish(ctx: PublishContext, containerId: string): Promise<RemoteState> {
    const s = await this.containerStatus(ctx, containerId);
    if (s !== "FINISHED") return { state: "processing", ref: containerId };
    return this.finish(ctx, containerId);
  }

  async getStatus(ctx: PublishContext, ref: string): Promise<RemoteState> {
    if (ref.startsWith("published:")) return { state: "published", platformPostId: ref.slice(10) };
    const s = await this.containerStatus(ctx, ref);
    if (s === "ERROR" || s === "EXPIRED") return { state: "failed", code: "MEDIA_REJECTED", message: `Container ${s}` };
    if (s === "PUBLISHED") {
      // Published on an earlier attempt whose response we lost: record it, never publish the container twice.
      const hit = await this.findExisting(ctx, { since: new Date(Date.now() - 24 * 3600_000) });
      return hit ? { state: "published", platformPostId: hit.platformPostId, url: hit.url } : { state: "failed", code: "UNKNOWN", message: "Container shows PUBLISHED but the Reel wasn't found on the profile." };
    }
    if (s !== "FINISHED") return { state: "processing", ref };
    return this.finish(ctx, ref);
  }

  private async containerStatus(ctx: PublishContext, id: string) {
    const r = await fetch(`${GRAPH}/${id}?fields=status_code&access_token=${ctx.account.accessToken}`);
    if (!r.ok) throw await httpFailure(r, "instagram container status");
    return ((await r.json()) as { status_code: string }).status_code;
  }

  private async finish(ctx: PublishContext, containerId: string): Promise<RemoteState> {
    const r = await formPost(`${GRAPH}/${ctx.account.platformUserId}/media_publish`, {
      creation_id: containerId,
      access_token: ctx.account.accessToken,
    });
    if (!r.ok) throw await httpFailure(r, "instagram media_publish");
    const id = ((await r.json()) as { id: string }).id;
    const link = await fetch(`${GRAPH}/${id}?fields=permalink&access_token=${ctx.account.accessToken}`).then((x) => (x.ok ? x.json() : {}));
    return { state: "published", platformPostId: id, url: (link as { permalink?: string }).permalink };
  }

  /** Match by caption among Reels posted since we asked to publish. */
  async findExisting(ctx: PublishContext, hint: { since: Date }) {
    const caption = [ctx.content.caption, ctx.content.hashtags].filter(Boolean).join("\n\n").trim();
    const r = await fetch(`${GRAPH}/${ctx.account.platformUserId}/media?fields=id,caption,permalink,timestamp,media_product_type&limit=10&access_token=${ctx.account.accessToken}`);
    if (!r.ok) throw await httpFailure(r, "instagram media lookup");
    const j = (await r.json()) as { data?: { id: string; caption?: string; permalink?: string; timestamp?: string }[] };
    const hit = j.data?.find((m) => (m.caption ?? "").trim() === caption && (!m.timestamp || new Date(m.timestamp) >= hint.since));
    return hit ? { platformPostId: hit.id, url: hit.permalink } : null;
  }

  async listComments(target: CommentTarget, account: AccountContext): Promise<PlatformComment[]> {
    const fields = "id,text,username,timestamp,like_count,replies{id,text,username,timestamp,like_count}";
    const r = await fetch(`${GRAPH}/${target.platformPostId}/comments?fields=${encodeURIComponent(fields)}&access_token=${account.accessToken}`);
    if (!r.ok) throw await httpFailure(r, "instagram comments");
    const j = (await r.json()) as { data?: IgComment[] };
    return (j.data ?? []).map((c) => ({ ...igComment(c), replies: (c.replies?.data ?? []).map((x) => ({ ...igComment(x), parentId: c.id })) }));
  }

  async replyToComment(account: AccountContext, commentId: string, text: string): Promise<PlatformComment> {
    const r = await formPost(`${GRAPH}/${commentId}/replies`, { message: text, access_token: account.accessToken });
    if (!r.ok) throw await httpFailure(r, "instagram comment reply");
    const { id } = (await r.json()) as { id: string };
    return { id, text, authorName: account.username, createdAt: new Date().toISOString(), parentId: commentId };
  }

  async delete() {
    throw new PublisherError("UNKNOWN", "Instagram does not allow deleting Reels through the API. Remove it in the app.", undefined, false);
  }
}

interface IgComment {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
  like_count?: number;
  replies?: { data?: IgComment[] };
}

function igComment(c: IgComment): PlatformComment {
  return {
    id: c.id,
    text: c.text ?? "",
    authorName: c.username ? `@${c.username}` : "Someone on Instagram",
    createdAt: c.timestamp ?? new Date().toISOString(),
    likeCount: c.like_count,
    parentId: null,
  };
}
