import { db } from "@/lib/db";
import { json, route } from "@/lib/http";
import { storage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * The publishing tracker's feed (1139, was the sending pill's small summary in 10-16g).
 * Your posts that are sending right now, plus any that settled in the last few minutes so a screen can say how
 * it ended. With ?id=<postId> it answers for that one post whatever state it is in, which is what the posting
 * screen uses for the facts a PostView doesn't carry: which account each destination goes to, and when the
 * platform last told us something. A post stuck "publishing" for over 6 hours is left to the sweeper.
 *
 * Everything here is read from the database rows the publishers wrote. There is no progress figure because no
 * platform reports one; `progress` exists in the shape for the day one does, and is left out until then.
 */
const SETTLED_MS = 180_000;
const STUCK_MS = 6 * 3600_000;

const SELECT = {
  id: true,
  title: true,
  hook: true,
  story: true,
  status: true,
  format: true,
  updatedAt: true,
  media: { select: { thumbnailKey: true, storageKey: true, mimeType: true } },
  items: { orderBy: { position: "asc" }, take: 1, select: { media: { select: { thumbnailKey: true, storageKey: true, mimeType: true } } } },
  targets: {
    orderBy: { platform: "asc" },
    select: {
      id: true,
      platform: true,
      platformStatus: true,
      platformUrl: true,
      errorCode: true,
      practice: true,
      title: true,
      caption: true,
      updatedAt: true,
      socialAccount: { select: { displayName: true, username: true, avatar: true } },
    },
  },
} as const;

type Thumb = { thumbnailKey: string | null; storageKey: string; mimeType: string } | null | undefined;

/** The picture to show: the video's frame, or the photo itself. A missing or unreachable object shows nothing. */
async function thumbUrl(m: Thumb) {
  const key = m?.thumbnailKey ?? (m?.mimeType.startsWith("image/") ? m.storageKey : null);
  if (!key || key.startsWith("sample/")) return null;
  if (key.startsWith("/")) return key;
  try {
    return await storage.signedUrl(key, 6 * 3600);
  } catch {
    return null;
  }
}

const line = (s: string | null | undefined, max: number) => {
  const first = (s ?? "").split("\n").find((x) => x.trim()) ?? "";
  return first.trim() ? first.trim().slice(0, max) : null;
};

export const GET = route(
  async (req, { user }) => {
    const id = new URL(req.url).searchParams.get("id");
    const now = Date.now();
    const rows = await db.post.findMany({
      where: id
        ? { id, userId: user.id }
        : {
            userId: user.id,
            OR: [
              { status: "publishing", updatedAt: { gt: new Date(now - STUCK_MS) } },
              { status: { in: ["published", "partial", "failed"] }, updatedAt: { gt: new Date(now - SETTLED_MS) } },
            ],
          },
      orderBy: { updatedAt: "desc" },
      take: id ? 1 : 5,
      select: SELECT,
    });
    const posts = await Promise.all(
      rows.map(async (p) => ({
        id: p.id,
        title: line(p.title || p.hook, 60) ?? "Your post",
        caption: line(p.targets.find((t) => t.caption)?.caption ?? p.story, 160),
        thumbnailUrl: (await thumbUrl(p.media)) ?? (await thumbUrl(p.items[0]?.media)),
        format: p.format ?? "video",
        status: p.status,
        updatedAt: p.updatedAt.toISOString(),
        targets: p.targets.map((t) => ({
          id: t.id,
          platform: t.platform,
          status: t.platformStatus,
          errorCode: t.errorCode,
          url: t.platformUrl,
          updatedAt: t.updatedAt.toISOString(),
          practice: t.practice,
          caption: line(t.title || t.caption, 160),
          account: t.socialAccount ? { name: t.socialAccount.displayName || t.socialAccount.username || "Connected account", username: t.socialAccount.username, avatar: t.socialAccount.avatar } : null,
        })),
      })),
    );
    return json({ posts });
  },
  { limit: [240, 60_000] },
);
