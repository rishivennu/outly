import { env } from "../env";
import { commonMediaChecks, httpFailure, type AccountContext, type CommentTarget, type PlatformComment, type SocialPublisher, type PublishContext, type RemoteState } from "./types";
import { formPost, newState } from "./oauth";

export interface GoogleTokens { access_token: string; refresh_token?: string; expires_in: number; id_token?: string }

const YT_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  // force-ssl is what lets us read and post comments; upload/readonly alone cannot.
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
].join(" ");

/** Who signed in with Google. Only verified addresses are trusted to sign in to Outly. */
export async function googleIdentity(accessToken: string) {
  const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!r.ok) throw await httpFailure(r, "google userinfo");
  return (await r.json()) as { sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
}

// YouTube Data API v3. A Short is a vertical video ≤ 3 min; "#Shorts" in title/description helps classification.
export class YouTubePublisher implements SocialPublisher {
  readonly platform = "youtube" as const;

  /** `identity` adds openid/email so the same consent can also sign the creator in to Outly. */
  async connect(redirectUri: string, opts: { identity?: boolean } = {}) {
    const state = newState();
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.search = new URLSearchParams({
      client_id: env.YOUTUBE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: `${opts.identity ? "openid email profile " : ""}${YT_SCOPES}`,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    }).toString();
    return { url: u.toString(), state };
  }

  async completeConnect(code: string, redirectUri: string) {
    const tok = await this.exchange(code, redirectUri);
    const prof = await this.channelProfile(tok);
    if (!prof) throw Object.assign(new Error("This Google account has no YouTube channel yet."), { code: "NO_CHANNEL" });
    return prof;
  }

  /** Swap the one-time code for tokens. Split out so Google sign-in can read identity first. */
  async exchange(code: string, redirectUri: string): Promise<GoogleTokens> {
    const t = await formPost("https://oauth2.googleapis.com/token", {
      code,
      client_id: env.YOUTUBE_CLIENT_ID,
      client_secret: env.YOUTUBE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    if (!t.ok) throw await httpFailure(t, "google token exchange");
    return (await t.json()) as GoogleTokens;
  }

  /** The channel behind these tokens, or null when the Google account has never made one. */
  async channelProfile(tok: GoogleTokens) {
    const ch = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
      headers: { authorization: `Bearer ${tok.access_token}` },
      cache: "no-store",
    });
    if (!ch.ok) throw await httpFailure(ch, "youtube channel");
    const c = ((await ch.json()) as { items?: { id: string; snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url: string } } } }[] }).items?.[0];
    if (!c) return null;
    return {
      platformUserId: c.id,
      username: c.snippet.customUrl ?? c.snippet.title,
      displayName: c.snippet.title,
      avatar: c.snippet.thumbnails?.default?.url,
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt: new Date(Date.now() + tok.expires_in * 1000),
    };
  }

  async refreshToken(account: { refreshToken?: string | null }) {
    const r = await formPost("https://oauth2.googleapis.com/token", {
      client_id: env.YOUTUBE_CLIENT_ID,
      client_secret: env.YOUTUBE_CLIENT_SECRET,
      refresh_token: account.refreshToken ?? "",
      grant_type: "refresh_token",
    });
    if (!r.ok) throw await httpFailure(r, "google refresh");
    const j = (await r.json()) as { access_token: string; expires_in: number };
    return { accessToken: j.access_token, refreshToken: account.refreshToken ?? undefined, expiresAt: new Date(Date.now() + j.expires_in * 1000) };
  }

  validateMedia(m: Parameters<SocialPublisher["validateMedia"]>[0]) {
    return commonMediaChecks(m, { name: "YouTube Shorts", maxDuration: 180, maxBytes: 2e9, preferVertical: true });
  }

  async upload(ctx: PublishContext) {
    // Resume a session saved by a previous attempt instead of creating a second video.
    if (ctx.resumeRef?.startsWith("session:")) {
      const done = await this.resume(ctx, ctx.resumeRef.slice(8));
      if (done) return done;
    }
    const title = (ctx.content.title ?? "Untitled").slice(0, 100);
    const description = [ctx.content.description, ctx.content.hashtags].filter(Boolean).join("\n\n");
    const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: {
        authorization: `Bearer ${ctx.account.accessToken}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": ctx.media.mimeType,
        "x-upload-content-length": String(ctx.media.size),
      },
      body: JSON.stringify({
        snippet: { title, description, categoryId: "22" },
        status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
      }),
    });
    if (!init.ok) throw await httpFailure(init, "youtube resumable init");
    const location = init.headers.get("location");
    if (!location) throw await httpFailure(init, "youtube missing upload location");
    await ctx.checkpoint?.(`session:${location}`);
    const put = await fetch(location, {
      method: "PUT",
      headers: { "content-type": ctx.media.mimeType, "content-length": String(ctx.media.size) },
      body: await ctx.media.readAll(),
    });
    if (!put.ok) throw await httpFailure(put, "youtube upload bytes");
    return ((await put.json()) as { id: string }).id;
  }

  /** Ask the resumable session how far it got; finish it if needed. null = session gone, start again. */
  private async resume(ctx: PublishContext, location: string): Promise<string | null> {
    const q = await fetch(location, { method: "PUT", headers: { "content-range": `bytes */${ctx.media.size}`, "content-length": "0" } });
    if (q.status === 200 || q.status === 201) return ((await q.json()) as { id: string }).id;
    if (q.status !== 308) return null;
    const range = q.headers.get("range"); // "bytes=0-12345"
    const next = range ? Number(range.split("-")[1]) + 1 : 0;
    const all = await ctx.media.readAll();
    const put = await fetch(location, {
      method: "PUT",
      headers: { "content-length": String(all.length - next), "content-range": `bytes ${next}-${all.length - 1}/${all.length}` },
      body: new Uint8Array(all.subarray(next)),
    });
    if (!put.ok) throw await httpFailure(put, "youtube resume upload");
    return ((await put.json()) as { id: string }).id;
  }

  async publish(ctx: PublishContext, videoId: string) {
    return this.getStatus(ctx, videoId);
  }

  async getStatus(ctx: PublishContext, videoId: string): Promise<RemoteState> {
    if (videoId.startsWith("session:")) return { state: "processing", ref: videoId };
    const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${videoId}`, {
      headers: { authorization: `Bearer ${ctx.account.accessToken}` },
    });
    if (!r.ok) throw await httpFailure(r, "youtube status");
    const v = ((await r.json()) as { items: { status: { uploadStatus: string; rejectionReason?: string; privacyStatus?: string } }[] }).items[0];
    if (!v) return { state: "processing", ref: videoId };
    const s = v.status.uploadStatus;
    if (s === "processed") {
      // Unaudited Google API projects get every upload locked to Private. Say so instead of implying it's public.
      if (v.status.privacyStatus === "private")
        return { state: "failed", code: "FORBIDDEN", message: `Uploaded as video ${videoId}, but YouTube locked it to Private. Unverified API projects can only post private videos until Google's API audit is approved.` };
      return { state: "published", platformPostId: videoId, url: `https://youtube.com/shorts/${videoId}` };
    }
    if (s === "rejected" || s === "failed" || s === "deleted")
      return { state: "failed", code: "MEDIA_REJECTED", message: v.status.rejectionReason ?? s };
    return { state: "processing", ref: videoId };
  }

  async listComments(target: CommentTarget, account: AccountContext): Promise<PlatformComment[]> {
    const q = new URLSearchParams({ part: "snippet,replies", videoId: target.platformPostId, maxResults: "50", order: "time" });
    const r = await fetch(`https://www.googleapis.com/youtube/v3/commentThreads?${q}`, {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    if (!r.ok) throw await httpFailure(r, "youtube commentThreads");
    const j = (await r.json()) as { items?: YtThread[] };
    return (j.items ?? []).map((t) => ({
      ...ytComment(t.snippet.topLevelComment),
      replies: (t.replies?.comments ?? []).map(ytComment),
    }));
  }

  async replyToComment(account: AccountContext, commentId: string, text: string): Promise<PlatformComment> {
    const r = await fetch("https://www.googleapis.com/youtube/v3/comments?part=snippet", {
      method: "POST",
      headers: { authorization: `Bearer ${account.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ snippet: { parentId: commentId, textOriginal: text } }),
    });
    if (!r.ok) throw await httpFailure(r, "youtube comments.insert");
    return ytComment((await r.json()) as YtComment);
  }

  async delete(account: { accessToken: string }, id: string) {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    if (!r.ok && r.status !== 404) throw await httpFailure(r, "youtube delete");
  }
}

interface YtComment {
  id: string;
  snippet: { textDisplay?: string; textOriginal?: string; authorDisplayName?: string; publishedAt?: string; likeCount?: number; parentId?: string };
}
interface YtThread {
  snippet: { topLevelComment: YtComment };
  replies?: { comments?: YtComment[] };
}

function ytComment(c: YtComment): PlatformComment {
  return {
    id: c.id,
    text: c.snippet.textOriginal ?? c.snippet.textDisplay ?? "",
    authorName: c.snippet.authorDisplayName ?? "Someone on YouTube",
    createdAt: c.snippet.publishedAt ?? new Date().toISOString(),
    likeCount: c.snippet.likeCount,
    parentId: c.snippet.parentId ?? null,
  };
}
