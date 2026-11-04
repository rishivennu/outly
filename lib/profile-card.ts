import "server-only";
import { db } from "./db";
import { isPlatform, PLATFORM_META, type Platform } from "./domain";
import { isPracticeAccount } from "./social/registry";
import { platformDashboard } from "./live";
import { aggregate, cardLinks, parseProfileLinks, progressOf, publicLinks, statsNote, type ProfileCardView, type TotalsRow } from "./profile-card-core";

/** A platform slower than this is left out of the totals (and named in the note) rather than holding the card. */
const PLATFORM_WAIT_MS = 8_000;
/** A manager can run dozens of accounts; the card reads the first few and says which were left out. */
const MAX_ACCOUNTS = 8;

const timeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]).catch(() => null);

/**
 * 1120: everything the creator profile card shows, from the database and the connected platforms only.
 * Practice (rehearsal) accounts and disconnected ones are never counted.
 */
export async function profileCard(userId: string): Promise<ProfileCardView> {
  const since = new Date(Date.now() - 30 * 864e5);
  const [u, accounts, published30] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true, avatar: true, handle: true, bio: true, niche: true, banner: true, profileLinks: true } }),
    db.socialAccount.findMany({ where: { userId, status: "connected" }, orderBy: { createdAt: "asc" }, select: { id: true, platform: true, username: true, platformUserId: true } }),
    db.postTarget.count({ where: { post: { userId }, platformStatus: "published", practice: false, publishedAt: { gte: since } } }),
  ]);
  const real = accounts.filter((a) => isPlatform(a.platform) && !isPracticeAccount(a));
  const read = real.slice(0, MAX_ACCOUNTS);

  const rows: TotalsRow[] = await Promise.all(
    read.map(async (a) => {
      const platform = a.platform as Platform;
      const [dash, outllyPosts] = await Promise.all([
        timeout(platformDashboard(userId, platform, { accountId: a.id }), PLATFORM_WAIT_MS),
        db.postTarget.count({ where: { socialAccountId: a.id, platformStatus: "published", practice: false } }),
      ]);
      return { platform, ok: dash?.status === "ok", totals: dash?.status === "ok" ? (dash.totals ?? null) : null, outllyPosts };
    }),
  );
  for (const a of real.slice(MAX_ACCOUNTS)) rows.push({ platform: a.platform as Platform, ok: false, totals: null, outllyPosts: 0 });

  const prefs = parseProfileLinks(u.profileLinks);
  const links = cardLinks(real, prefs);
  const stats = aggregate(rows);
  const progress = progressOf({
    photo: !!u.avatar,
    cover: !!u.banner,
    bio: !!u.bio?.trim(),
    handle: !!u.handle,
    niche: !!u.niche?.trim(),
    connected: new Set(real.map((a) => a.platform)).size,
    publicLinks: publicLinks(links).length,
    published30,
  });
  return {
    name: u.name,
    handle: u.handle,
    bio: u.bio,
    niche: u.niche,
    avatar: u.avatar,
    banner: u.banner,
    email: u.email,
    links,
    stats,
    note: statsNote(stats, (p) => PLATFORM_META[p].name),
    progress,
    connected: real.length,
    fetchedAt: new Date().toISOString(),
  };
}
