import { env } from "../env";
import type { Platform } from "../domain";
import { PLATFORM_META } from "../domain";
import { commonMediaChecks, PublisherError, type AccountContext, type CommentTarget, type PlatformComment, type SocialPublisher, type PublishContext, type RemoteState } from "./types";
import { newState } from "./oauth";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (min: number, max: number) => min + Math.random() * (max - min);

const HANDLES: Record<Platform, { username: string; displayName: string }> = {
  instagram: { username: "@maya.makes", displayName: "Maya Makes" },
  youtube: { username: "Maya Makes Things", displayName: "Maya Makes Things" },
  x: { username: "@mayamakes", displayName: "Maya" },
  tiktok: { username: "@maya.makes", displayName: "Maya Makes" },
  threads: { username: "@maya.makes", displayName: "Maya Makes" },
  facebook: { username: "Maya Makes", displayName: "Maya Makes" },
  linkedin: { username: "Maya Rao", displayName: "Maya Rao" },
};

// Per-platform pacing so the three destinations visibly update independently.
const PACE: Record<Platform, { upload: [number, number]; process: [number, number] }> = {
  instagram: { upload: [1800, 3200], process: [1400, 2600] },
  youtube: { upload: [2600, 4200], process: [2200, 3600] },
  x: { upload: [1000, 1800], process: [700, 1400] },
  tiktok: { upload: [2000, 3400], process: [1600, 2800] },
  threads: { upload: [1400, 2400], process: [1000, 2000] },
  facebook: { upload: [2200, 3600], process: [1800, 3000] },
  linkedin: { upload: [2400, 3800], process: [2000, 3200] },
};

/**
 * Behaves like a real platform: OAuth round-trip, upload, async processing, and a
 * confirmation step. "Published" is only ever returned from the final status
 * check, mirroring the rule that the UI never shows Published before the API confirms.
 */
export class MockPublisher implements SocialPublisher {
  constructor(readonly platform: Platform) {}

  async connect(redirectUri: string) {
    const state = newState();
    const u = new URL(redirectUri);
    u.searchParams.set("code", `mock_code_${this.platform}`);
    u.searchParams.set("state", state);
    return { url: u.toString(), state };
  }

  async completeConnect() {
    await sleep(400);
    return {
      platformUserId: `mock-${this.platform}-001`,
      ...HANDLES[this.platform],
      accessToken: `mock_access_${this.platform}_${Date.now()}`,
      refreshToken: `mock_refresh_${this.platform}`,
      expiresAt: new Date(Date.now() + 60 * 24 * 3600 * 1000),
    };
  }

  async refreshToken() {
    return { accessToken: `mock_access_${this.platform}_${Date.now()}`, refreshToken: `mock_refresh_${this.platform}`, expiresAt: new Date(Date.now() + 60 * 24 * 3600 * 1000) };
  }

  validateMedia(m: Parameters<SocialPublisher["validateMedia"]>[0]) {
    const meta = PLATFORM_META[this.platform];
    return commonMediaChecks(m, { name: meta.name, maxDuration: meta.maxDurationSec, maxBytes: 600e6, preferVertical: this.platform !== "x" });
  }

  private maybeFail(ctx: PublishContext, stage: "upload" | "publish") {
    const sim = ctx.simulate ?? "realistic";
    if (sim === "smooth") return;
    if (sim === "instagram-reconnect" && this.platform === "instagram" && stage === "upload")
      throw new PublisherError("AUTH_EXPIRED", "Token expired", 'HTTP 401 Unauthorized\n{"error":{"message":"Error validating access token: Session has expired.","type":"OAuthException","code":190}}', false);
    if (sim === "youtube-flaky" && this.platform === "youtube" && stage === "upload" && ctx.attempt < 2)
      throw new PublisherError("NETWORK", "Connection reset", "ECONNRESET while streaming chunk 3/7 to upload.youtube.com");
    if (sim === "x-rejects" && this.platform === "x" && stage === "publish")
      throw new PublisherError("MEDIA_REJECTED", "Media rejected", 'HTTP 400\n{"errors":[{"message":"Video duration exceeds the limit for this account tier."}]}', false);
    if (sim === "realistic" && ctx.attempt === 0 && Math.random() < env.MOCK_FAILURE_RATE / 2)
      throw new PublisherError("RATE_LIMITED", "Rate limited", "HTTP 429 Too Many Requests\nx-rate-limit-remaining: 0");
  }

  async upload(ctx: PublishContext) {
    await sleep(jitter(...PACE[this.platform].upload));
    this.maybeFail(ctx, "upload");
    return `mock-upload-${this.platform}-${Date.now().toString(36)}`;
  }

  async publish(ctx: PublishContext, ref: string): Promise<RemoteState> {
    await sleep(jitter(...PACE[this.platform].process) / 2);
    this.maybeFail(ctx, "publish");
    return { state: "processing", ref };
  }

  async getStatus(_ctx: PublishContext, ref: string): Promise<RemoteState> {
    await sleep(jitter(...PACE[this.platform].process) / 2);
    // Practice runs never produce a link: there is no real post to open.
    return { state: "published", platformPostId: `practice_${ref.replace("mock-upload-", "")}` };
  }

  /** Deterministic from the post id, so a practice inbox looks the same on every refresh. */
  async listComments(target: CommentTarget): Promise<PlatformComment[]> {
    await sleep(120);
    const base = seed(`${this.platform}:${target.platformPostId}`);
    const count = 2 + (base % 3);
    const out: PlatformComment[] = [];
    for (let i = 0; i < count; i++) {
      const n = seed(`${this.platform}:${target.platformPostId}:${i}`);
      out.push({
        id: `practice-${this.platform}-${target.platformPostId}-${i}`,
        text: PRACTICE_TEXT[n % PRACTICE_TEXT.length],
        authorName: PRACTICE_AUTHORS[n % PRACTICE_AUTHORS.length],
        // Spaced an hour apart from a fixed offset, newest first.
        createdAt: new Date(Date.now() - (i + 1) * 3600_000).toISOString(),
        likeCount: n % 40,
        parentId: null,
        practice: true,
        replies: (mockReplies.get(`practice-${this.platform}-${target.platformPostId}-${i}`) ?? []).slice(),
      });
    }
    return out;
  }

  async replyToComment(_account: AccountContext, commentId: string, text: string): Promise<PlatformComment> {
    await sleep(200);
    const reply: PlatformComment = {
      id: `practice-reply-${commentId}-${(mockReplies.get(commentId)?.length ?? 0) + 1}`,
      text,
      authorName: HANDLES[this.platform].username,
      createdAt: new Date().toISOString(),
      parentId: commentId,
      practice: true,
    };
    mockReplies.set(commentId, [...(mockReplies.get(commentId) ?? []), reply]);
    return reply;
  }

  async delete() {
    await sleep(300);
  }
}

/** Practice replies live in memory: a rehearsal must not leave anything behind. */
const g = globalThis as unknown as { __mockReplies?: Map<string, PlatformComment[]> };
const mockReplies = (g.__mockReplies ??= new Map<string, PlatformComment[]>());

const PRACTICE_TEXT = [
  "This is the one. Where did you shoot it?",
  "Saved it to show my sister 😂",
  "the edit at 0:04 is so clean",
  "Part two please",
  "Honestly needed to hear this today",
  "What mic are you using?",
];
const PRACTICE_AUTHORS = ["Practice viewer", "@rehearsal.rina", "@dry.run.dev", "Practice audience", "@sandbox.sam"];

function seed(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
