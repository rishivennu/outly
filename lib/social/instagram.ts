import { creds, dmsOn } from "./keys";
import { commonMediaChecks, httpFailure, PublisherError, type AccountContext, type CommentTarget, type PlatformComment, type ConnectOptions, type SocialPublisher, type PublishContext, type RemoteState } from "./types";
import { formPost, newState } from "./oauth";

// Instagram API with Instagram Login (professional accounts). Reels are published as a container:
//   POST /{ig-user-id}/media (media_type=REELS, video_url) → poll status_code → POST /{ig-user-id}/media_publish
// 1131: Stories (media_type=STORIES), photos (image_url) and carousels (a child container per slide with
// is_carousel_item, then a CAROUSEL container with children) go through the same create → poll → publish steps.
const GRAPH = "https://graph.instagram.com/v21.0";
/** Upload ref while carousel slides are still processing: "kids:<id>,<id>,...". The parent is made once all are FINISHED. */
const KIDS = "kids:";
/** Checkpoint while slide containers are being created, so a crash resumes instead of making them again. */
const KIDS_SESSION = "session:igkids:";

// instagram_business_manage_comments is what the inbox needs; without it comment reads return 403.
const IG_BASE_SCOPES = "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments";
/** Direct messages (1031). Left out when the admin switches DMs off (1031f). */
export const IG_DM_SCOPE = "instagram_business_manage_messages";
export const instagramScopes = (dms: boolean) => (dms ? `${IG_BASE_SCOPES},${IG_DM_SCOPE}` : IG_BASE_SCOPES);

/**
 * The code-for-token answer. Meta documents it wrapped as {"data":[{access_token,user_id,permissions}]},
 * and older apps still get the flat {access_token,user_id}. Reading only the flat shape left the token
 * undefined, the long-lived swap then failed, and people saw "couldn't finish the handshake" (1031).
 */
export function shortToken(raw: unknown): { access_token: string; user_id: string | number; permissions?: string | string[] } | null {
  const r = raw as { access_token?: unknown; data?: unknown } | null;
  const row = (Array.isArray(r?.data) ? r!.data[0] : r) as { access_token?: unknown; user_id?: string | number; permissions?: string | string[] } | null | undefined;
  if (!row || typeof row.access_token !== "string" || !row.access_token) return null;
  return { access_token: row.access_token, user_id: row.user_id ?? "", permissions: row.permissions };
}

/** Messages need this one; Instagram lets the person untick it and still connect. Empty when unknown. */
export function missingScopes(granted: string | string[] | undefined): string[] {
  if (!granted) return [];
  const have = new Set((Array.isArray(granted) ? granted : granted.split(",")).map((x) => x.trim()));
  return [IG_DM_SCOPE].filter((x) => !have.has(x));
}

export class InstagramPublisher implements SocialPublisher {
  readonly platform = "instagram" as const;

  async connect(redirectUri: string, opts: ConnectOptions = {}) {
    const state = newState();
    const u = new URL("https://www.instagram.com/oauth/authorize");
    u.search = new URLSearchParams({
      client_id: creds("instagram").clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: instagramScopes(dmsOn("instagram")),
      state,
      // 1095: Instagram's documented switch to ask for the login even when someone is signed in already.
      ...(opts.fresh ? { force_reauth: "true" } : {}),
    }).toString();
    return { url: u.toString(), state };
  }

  async completeConnect(code: string, redirectUri: string) {
    const short = await formPost("https://api.instagram.com/oauth/access_token", {
      client_id: creds("instagram").clientId,
      client_secret: creds("instagram").clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    });
    if (!short.ok) throw await httpFailure(short, "instagram token exchange");
    const s = shortToken(await short.json().catch(() => null));
    if (!s) throw new PublisherError("UNKNOWN", "Instagram sent no access token", "instagram token exchange: 200 without an access_token", false);
    const long = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(creds("instagram").clientSecret)}&access_token=${encodeURIComponent(s.access_token)}`,
    );
    if (!long.ok) throw await httpFailure(long, "instagram long-lived exchange");
    const l = (await long.json()) as { access_token: string; expires_in: number };
    let me = await fetch(`${GRAPH}/me?fields=user_id,username,name,profile_picture_url&access_token=${encodeURIComponent(l.access_token)}`);
    // Some accounts refuse the optional fields; the id and handle are all a connection needs (1031e).
    if (!me.ok && me.status === 400) me = await fetch(`${GRAPH}/me?fields=user_id,username&access_token=${encodeURIComponent(l.access_token)}`);
    if (!me.ok) throw await httpFailure(me, "instagram profile");
    const p = (await me.json()) as { user_id: string; username: string; name?: string; profile_picture_url?: string };
    return {
      platformUserId: String(p.user_id ?? s.user_id),
      username: `@${p.username}`,
      displayName: p.name,
      avatar: p.profile_picture_url,
      accessToken: l.access_token,
      expiresAt: new Date(Date.now() + l.expires_in * 1000),
      // With DMs switched off we never asked for messages, so nothing was declined.
      declined: dmsOn("instagram") ? missingScopes(s.permissions) : [],
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
    const format = ctx.format ?? "video";
    if (format === "story") return this.container(ctx, { media_type: "STORIES", ...(isImage(ctx.media) ? { image_url: await ctx.media.publicUrl() } : { video_url: await ctx.media.publicUrl() }) }, "instagram create story container");
    if (format === "photo")
      return this.container(ctx, { image_url: await ctx.media.publicUrl(), caption: captionOf(ctx), ...(ctx.media.altText?.trim() ? { alt_text: ctx.media.altText.trim().slice(0, 1000) } : {}) }, "instagram create photo container");
    if (format === "carousel") return this.carouselKids(ctx);
    const caption = captionOf(ctx);
    const fields: Record<string, string> = {
      media_type: "REELS",
      video_url: await ctx.media.publicUrl(),
      caption,
      share_to_feed: "true",
      access_token: ctx.account.accessToken,
    };
    // 1083: the creator's cover (cover_url wins over thumb_offset). If Instagram refuses the container with it,
    // try once without: the Reel matters more than its cover, and the creator is told why it has a frame instead.
    const coverUrl = ctx.cover ? await ctx.cover.url().catch(() => null) : null;
    const create = (f: Record<string, string>) => formPost(`${GRAPH}/${ctx.account.platformUserId}/media`, f);
    let r = await create(coverUrl ? { ...fields, cover_url: coverUrl } : fields);
    if (!r.ok && coverUrl) {
      const err = await httpFailure(r, "instagram create container (with cover)");
      if (err.code !== "MEDIA_REJECTED") throw err;
      r = await create(fields);
      if (r.ok) await ctx.noteCover?.("Instagram couldn't use the cover image, so it picked a frame from the video.");
    } else if (r.ok && coverUrl) await ctx.noteCover?.(null);
    if (!r.ok) throw await httpFailure(r, "instagram create container");
    return ((await r.json()) as { id: string }).id;
  }

  /** One container, its id back. */
  private async container(ctx: PublishContext, f: Record<string, string>, what: string) {
    const r = await formPost(`${GRAPH}/${ctx.account.platformUserId}/media`, { ...f, access_token: ctx.account.accessToken });
    if (!r.ok) throw await httpFailure(r, what);
    return ((await r.json()) as { id: string }).id;
  }

  /**
   * 1131: a child container for every slide, in order. Each one made is checkpointed, so an upload that dies
   * halfway picks up at the next slide instead of making the first ones again. Returns "kids:<ids>".
   */
  private async carouselKids(ctx: PublishContext) {
    const items = ctx.items ?? [ctx.media];
    const done = ctx.resumeRef?.startsWith(KIDS_SESSION) ? ctx.resumeRef.slice(KIDS_SESSION.length).split(",").filter(Boolean) : [];
    for (let i = done.length; i < items.length; i++) {
      const s = items[i];
      const f: Record<string, string> = isImage(s)
        ? { image_url: await s.publicUrl(), is_carousel_item: "true", ...(s.altText?.trim() ? { alt_text: s.altText.trim().slice(0, 1000) } : {}) }
        : { media_type: "VIDEO", video_url: await s.publicUrl(), is_carousel_item: "true" };
      done.push(await this.container(ctx, f, `instagram create carousel slide ${i + 1}`));
      await ctx.checkpoint?.(`${KIDS_SESSION}${done.join(",")}`);
    }
    return `${KIDS}${done.join(",")}`;
  }

  /**
   * 1131: wait for every slide (videos take a while), then make the CAROUSEL container. Its id becomes the ref,
   * and from there it is polled and published like any other container.
   */
  private async carouselStep(ctx: PublishContext, ref: string): Promise<RemoteState> {
    const kids = ref.slice(KIDS.length).split(",").filter(Boolean);
    for (const [i, id] of kids.entries()) {
      const s = await this.containerStatus(ctx, id);
      if (s === "ERROR" || s === "EXPIRED") return { state: "failed", code: "MEDIA_REJECTED", message: `Instagram couldn't use slide ${i + 1} (${s}).` };
      if (s !== "FINISHED") return { state: "processing", ref };
    }
    const parent = await this.container(ctx, { media_type: "CAROUSEL", children: kids.join(","), caption: captionOf(ctx) }, "instagram create carousel container");
    return { state: "processing", ref: parent };
  }

  /** Same answers as a status check, so a container Instagram refused (ERROR, EXPIRED) fails with its reason
   *  straight away instead of being polled until it times out. */
  async publish(ctx: PublishContext, containerId: string): Promise<RemoteState> {
    return this.getStatus(ctx, containerId);
  }

  async getStatus(ctx: PublishContext, ref: string): Promise<RemoteState> {
    if (ref.startsWith("published:")) return { state: "published", platformPostId: ref.slice(10) };
    if (ref.startsWith(KIDS)) return this.carouselStep(ctx, ref);
    const s = await this.containerStatus(ctx, ref);
    if (s === "ERROR" || s === "EXPIRED") return { state: "failed", code: "MEDIA_REJECTED", message: `Container ${s}` };
    if (s === "PUBLISHED") {
      // Published on an earlier attempt whose response we lost: record it, never publish the container twice.
      const hit = await this.findExisting(ctx, { since: new Date(Date.now() - 24 * 3600_000), uploadRef: ref });
      return hit ? { state: "published", platformPostId: hit.platformPostId, url: hit.url } : { state: "failed", code: "UNKNOWN", message: "Container shows PUBLISHED but the post wasn't found on the profile." };
    }
    if (s !== "FINISHED") return { state: "processing", ref };
    return this.finish(ctx, ref);
  }

  /** 1131: true only when this target's own container says PUBLISHED, the one proof that it went out. */
  private async wentOut(ctx: PublishContext, ref?: string | null) {
    if (!ref || ref.startsWith(KIDS) || ref.startsWith("session:") || ref.startsWith("published:")) return false;
    return (await this.containerStatus(ctx, ref).catch(() => null)) === "PUBLISHED";
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

  /**
   * Match by caption among posts made since we asked to publish. Stories have no caption and live on their own
   * edge (/stories). With no caption to match, "the newest one since then" could be someone else's (another
   * Story queued a minute later, or one posted from the phone), so it only counts once our own container says
   * PUBLISHED. Otherwise null, and the container itself is asked again.
   */
  async findExisting(ctx: PublishContext, hint: { since: Date; uploadRef?: string | null }) {
    if (ctx.format === "story") {
      if (!(await this.wentOut(ctx, hint.uploadRef))) return null;
      const r = await fetch(`${GRAPH}/${ctx.account.platformUserId}/stories?fields=id,permalink,timestamp&access_token=${ctx.account.accessToken}`);
      if (!r.ok) throw await httpFailure(r, "instagram stories lookup");
      const j = (await r.json()) as { data?: { id: string; permalink?: string; timestamp?: string }[] };
      const hit = (j.data ?? []).filter((m) => m.timestamp && new Date(m.timestamp) >= hint.since).sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""))[0];
      return hit ? { platformPostId: hit.id, url: hit.permalink } : null;
    }
    const caption = captionOf(ctx).trim();
    if (!caption && !(await this.wentOut(ctx, hint.uploadRef))) return null;
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

  async postComment(account: AccountContext, mediaId: string, text: string) {
    const r = await formPost(`${GRAPH}/${mediaId}/comments`, { message: text, access_token: account.accessToken });
    if (!r.ok) throw await httpFailure(r, "instagram first comment");
    return { id: ((await r.json()) as { id: string }).id };
  }

  async delete() {
    throw new PublisherError("UNKNOWN", "Instagram does not allow deleting posts through the API. Remove it in the app.", undefined, false);
  }
}

const captionOf = (ctx: PublishContext) => [ctx.content.caption, ctx.content.hashtags].filter(Boolean).join("\n\n");
const isImage = (m: { mimeType: string }) => m.mimeType.startsWith("image/");

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
