import { commonMediaChecks, httpFailure, PublisherError, type AccountContext, type CommentTarget, type PlatformComment, type SocialPublisher, type PublishContext, type RemoteState } from "./types";
import { collectPages, COMMENT_PAGES } from "./paging";
import { formPost, newState } from "./oauth";
import { creds } from "./keys";

// Threads API: container (media_type=VIDEO, video_url) -> poll status -> threads_publish. Same shape as Instagram Reels.
const GRAPH = "https://graph.threads.net/v1.0";

export class ThreadsPublisher implements SocialPublisher {
  readonly platform = "threads" as const;

  async connect(redirectUri: string) {
    const state = newState();
    const u = new URL("https://threads.net/oauth/authorize");
    u.search = new URLSearchParams({ client_id: creds("threads").clientId, redirect_uri: redirectUri, scope: "threads_basic,threads_content_publish,threads_delete,threads_manage_insights,threads_read_replies,threads_manage_replies", response_type: "code", state }).toString();
    return { url: u.toString(), state };
  }

  async completeConnect(code: string, redirectUri: string) {
    const { clientId, clientSecret } = creds("threads");
    const short = await formPost("https://graph.threads.net/oauth/access_token", { client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code });
    if (!short.ok) throw await httpFailure(short, "threads token exchange");
    const s = (await short.json()) as { access_token: string; user_id: string | number };
    const long = await fetch(`https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${encodeURIComponent(clientSecret)}&access_token=${s.access_token}`);
    if (!long.ok) throw await httpFailure(long, "threads long-lived exchange");
    const l = (await long.json()) as { access_token: string; expires_in: number };
    const me = await fetch(`${GRAPH}/me?fields=id,username,name,threads_profile_picture_url&access_token=${l.access_token}`);
    if (!me.ok) throw await httpFailure(me, "threads profile");
    const p = (await me.json()) as { id: string; username: string; name?: string; threads_profile_picture_url?: string };
    return { platformUserId: String(p.id ?? s.user_id), username: `@${p.username}`, displayName: p.name, avatar: p.threads_profile_picture_url, accessToken: l.access_token, expiresAt: new Date(Date.now() + l.expires_in * 1000) };
  }

  async refreshToken(account: { accessToken: string }) {
    const r = await fetch(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${account.accessToken}`);
    if (!r.ok) throw await httpFailure(r, "threads refresh");
    const j = (await r.json()) as { access_token: string; expires_in: number };
    return { accessToken: j.access_token, expiresAt: new Date(Date.now() + j.expires_in * 1000) };
  }

  validateMedia(m: Parameters<SocialPublisher["validateMedia"]>[0]) {
    return commonMediaChecks(m, { name: "Threads", maxDuration: 300, maxBytes: 1e9 });
  }

  async upload(ctx: PublishContext) {
    if (ctx.resumeRef) return ctx.resumeRef;
    const text = [ctx.content.caption, ctx.content.hashtags].filter(Boolean).join("\n\n").slice(0, 500);
    const r = await formPost(`${GRAPH}/${ctx.account.platformUserId}/threads`, { media_type: "VIDEO", video_url: await ctx.media.publicUrl(), text, access_token: ctx.account.accessToken });
    if (!r.ok) throw await httpFailure(r, "threads create container");
    const id = ((await r.json()) as { id: string }).id;
    await ctx.checkpoint?.(id);
    return id;
  }

  async publish(ctx: PublishContext, containerId: string) {
    return this.getStatus(ctx, containerId);
  }

  async getStatus(ctx: PublishContext, ref: string): Promise<RemoteState> {
    const r = await fetch(`${GRAPH}/${ref}?fields=status,error_message&access_token=${ctx.account.accessToken}`);
    if (!r.ok) throw await httpFailure(r, "threads container status");
    const j = (await r.json()) as { status: string; error_message?: string };
    if (j.status === "ERROR" || j.status === "EXPIRED") return { state: "failed", code: "MEDIA_REJECTED", message: j.error_message ?? `Container ${j.status}` };
    if (j.status === "PUBLISHED") return { state: "failed", code: "UNKNOWN", message: "Threads says this container was already published. Check your profile before retrying." };
    if (j.status !== "FINISHED") return { state: "processing", ref };
    const p = await formPost(`${GRAPH}/${ctx.account.platformUserId}/threads_publish`, { creation_id: ref, access_token: ctx.account.accessToken });
    if (!p.ok) throw await httpFailure(p, "threads publish");
    const id = ((await p.json()) as { id: string }).id;
    const link = await fetch(`${GRAPH}/${id}?fields=permalink&access_token=${ctx.account.accessToken}`).then((x) => (x.ok ? x.json() : {}));
    return { state: "published", platformPostId: id, url: (link as { permalink?: string }).permalink };
  }

  /** 1252: every reply in the post's conversation (threads_read_replies), nested one level under the reply to the post itself. */
  async listComments(target: CommentTarget, account: AccountContext): Promise<PlatformComment[]> {
    return threadsConversation(target.platformPostId, account.accessToken);
  }

  /** 1252: a reply is a text post with reply_to_id, created then published like any other (threads_manage_replies). */
  async replyToComment(account: AccountContext, commentId: string, text: string): Promise<PlatformComment> {
    const c = await formPost(`${GRAPH}/${account.platformUserId}/threads`, { media_type: "TEXT", text: text.slice(0, 500), reply_to_id: commentId, access_token: account.accessToken });
    if (!c.ok) throw await httpFailure(c, "threads reply container");
    const creation = ((await c.json()) as { id: string }).id;
    const p = await formPost(`${GRAPH}/${account.platformUserId}/threads_publish`, { creation_id: creation, access_token: account.accessToken });
    if (!p.ok) throw await httpFailure(p, "threads reply publish");
    const { id } = (await p.json()) as { id: string };
    return { id, text, authorName: account.username, createdAt: new Date().toISOString(), parentId: commentId };
  }

  async delete(account: { accessToken: string }, id: string) {
    const r = await fetch(`${GRAPH}/${id}?access_token=${account.accessToken}`, { method: "DELETE" });
    if (!r.ok) throw await httpFailure(r, "threads delete");
    // Graph can answer 200 {"success":false}: a refusal, never record it as gone.
    if (((await r.json().catch(() => ({}))) as { success?: boolean }).success === false)
      throw new PublisherError("UNKNOWN", "Threads didn't delete it", "threads delete: 200 success=false", false);
  }
}

export type ThreadsReply = { id: string; text?: string; username?: string; timestamp?: string; replied_to?: { id: string }; is_reply?: boolean; hide_status?: string };
export const threadsReplyFields = "id,text,username,timestamp,replied_to,is_reply,hide_status";

/**
 * /conversation lists every reply under a post, nested ones included, each pointing at what it answered.
 * Outlly shows one level: a reply to the post is a comment, anything deeper sits under the comment it descends from.
 */
export function nestThreadsReplies(postId: string, rows: ThreadsReply[]): PlatformComment[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const topOf = (r: ThreadsReply): string | null => {
    let cur = r;
    for (let i = 0; i < 20; i++) {
      const up = cur.replied_to?.id;
      if (!up || up === postId) return cur === r ? null : cur.id;
      const parent = byId.get(up);
      if (!parent) return cur === r ? null : cur.id;
      cur = parent;
    }
    return cur.id;
  };
  const toComment = (r: ThreadsReply, parentId: string | null): PlatformComment => ({ id: r.id, text: r.text ?? "", authorName: r.username ? `@${r.username}` : "Someone on Threads", createdAt: r.timestamp ?? new Date().toISOString(), parentId });
  const top = rows.filter((r) => topOf(r) === null).map((r) => ({ ...toComment(r, null), replies: [] as PlatformComment[] }));
  const topMap = new Map(top.map((t) => [t.id, t]));
  for (const r of rows) {
    const root = topOf(r);
    if (root === null) continue;
    const t = topMap.get(root);
    if (t) t.replies!.push(toComment(r, r.replied_to?.id ?? root));
  }
  return top;
}

export async function threadsConversation(postId: string, token: string, pages = COMMENT_PAGES.threads): Promise<PlatformComment[]> {
  const base = `${GRAPH}/${postId}/conversation?fields=${threadsReplyFields}&reverse=false&limit=50&access_token=${encodeURIComponent(token)}`;
  const { items } = await collectPages<ThreadsReply>(async (after) => {
    const r = await fetch(after ? `${base}&after=${encodeURIComponent(after)}` : base, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!r.ok) throw await httpFailure(r, "threads replies");
    const j = (await r.json()) as { data?: ThreadsReply[]; paging?: { next?: string; cursors?: { after?: string } } };
    return { items: j.data ?? [], next: (j.paging?.next && j.paging.cursors?.after) || null };
  }, pages);
  return nestThreadsReplies(postId, items);
}

