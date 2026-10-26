import { commonMediaChecks, httpFailure, PublisherError, type SocialPublisher, type PublishContext, type RemoteState } from "./types";
import { formPost, newState } from "./oauth";
import { creds } from "./keys";

// Threads API: container (media_type=VIDEO, video_url) -> poll status -> threads_publish. Same shape as Instagram Reels.
const GRAPH = "https://graph.threads.net/v1.0";

export class ThreadsPublisher implements SocialPublisher {
  readonly platform = "threads" as const;

  async connect(redirectUri: string) {
    const state = newState();
    const u = new URL("https://threads.net/oauth/authorize");
    u.search = new URLSearchParams({ client_id: creds("threads").clientId, redirect_uri: redirectUri, scope: "threads_basic,threads_content_publish,threads_read_replies,threads_manage_replies,threads_delete", response_type: "code", state }).toString();
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

  async delete(account: { accessToken: string }, id: string) {
    const r = await fetch(`${GRAPH}/${id}?access_token=${account.accessToken}`, { method: "DELETE" });
    if (!r.ok) throw await httpFailure(r, "threads delete");
    // Graph can answer 200 {"success":false}: a refusal, never record it as gone.
    if (((await r.json().catch(() => ({}))) as { success?: boolean }).success === false)
      throw new PublisherError("UNKNOWN", "Threads didn't delete it", "threads delete: 200 success=false", false);
  }
}
