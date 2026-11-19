import "server-only";
import { db } from "../db";
import { postFilter } from "../profiles";
import { postView, type PostView } from "../services";
import type { SessionUser } from "../auth";

/**
 * Content library pages (1091). The page used to load 200 posts with every review, sign 400+ media URLs
 * and sum views over every target the workspace ever had, on each visit. Now:
 *  - 48 posts per page, newest edit first, with a stable tie-break (id) so a cursor never skips or repeats;
 *  - views are summed only for the targets on this page (TargetMetric is indexed by targetId);
 *  - the tab counts come from one groupBy, so they are right without loading every post.
 */
export const LIBRARY_PAGE = 48;

export type LibraryCounts = { all: number; draft: number; scheduled: number; published: number; failed: number; archived: number; deleted: number; needs_verification: number };
export interface LibraryPage {
  posts: PostView[];
  views: Record<string, number>;
  nextCursor: string | null;
}

type U = Pick<SessionUser, "id" | "scope">;

/** A Content tab. "failed" covers partial posts too, as the tab does. */
export const LIBRARY_STATUSES = ["draft", "scheduled", "published", "failed", "archived", "deleted", "needs_verification"] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];
export const isLibraryStatus = (v: unknown): v is LibraryStatus => typeof v === "string" && (LIBRARY_STATUSES as readonly string[]).includes(v);

/**
 * R1219: lifecycle tabs (lib/posts/lifecycle), as database filters.
 *  - deleted: every copy that went live is gone from its platform (taken down from here, or found gone there);
 *  - needs_verification: a platform said "no such post" once and Outlly hasn't confirmed it yet;
 *  - archived: the creator took it out of the active views.
 * "All" and the publishing tabs are the ACTIVE library: not archived, not deleted.
 */
const stillLive = { platformStatus: "published", platformPostId: { not: null }, OR: [{ removeMode: null }, { removeMode: { not: "deleted" } }] };
export const DELETED_WHERE = { archivedAt: null, targets: { some: { removeMode: "deleted" } }, NOT: { targets: { some: stillLive } } };
export const ARCHIVED_WHERE = { archivedAt: { not: null } };
export const NEEDS_VERIFICATION_WHERE = { archivedAt: null, targets: { some: { verifyState: "needs_verification", ...stillLive } } };
export const ACTIVE_WHERE = { archivedAt: null, NOT: DELETED_WHERE };
const statusWhere = (s?: LibraryStatus | null) =>
  s === "archived"
    ? ARCHIVED_WHERE
    : s === "deleted"
      ? DELETED_WHERE
      : s === "needs_verification"
        ? NEEDS_VERIFICATION_WHERE
        : { ...ACTIVE_WHERE, ...(!s ? {} : s === "failed" ? { status: { in: ["failed", "partial"] } } : { status: s }) };

// Case-insensitive search: Postgres needs `mode`, SQLite's LIKE already ignores ASCII case (and rejects `mode`). Same as lib/site.ts.
const ci = (process.env.DATABASE_URL ?? "").startsWith("postgres") ? { mode: "insensitive" as const } : {};
/** 1148: the library's search box, when not every post is loaded yet: title, caption, hook, file name or tags. */
export const LIBRARY_Q_MAX = 100;
const searchWhere = (q?: string | null) => {
  const s = q?.trim().slice(0, LIBRARY_Q_MAX);
  if (!s) return [];
  const c = { contains: s, ...ci };
  return [{ OR: [{ title: c }, { hook: c }, { story: c }, { media: { originalFilename: c } }, { targets: { some: { OR: [{ title: c }, { caption: c }, { description: c }, { hashtags: c }] } } }] }];
};

/** `filter` is postFilter(user).where (the active profile); the page and API compute it, tests pass {}. */
type Filter = Awaited<ReturnType<typeof postFilter>>["where"];
const filterFor = async (user: U, filter?: Filter) => filter ?? (await postFilter(user)).where;

export async function libraryPage(user: U, cursor: string | null = null, take = LIBRARY_PAGE, filter?: Filter, status?: LibraryStatus | null, q?: string | null): Promise<LibraryPage> {
  const n = Math.max(1, Math.min(LIBRARY_PAGE, Math.floor(take) || LIBRARY_PAGE));
  // A tab pages through its own posts, so "Scheduled" never shows an empty grid while the count says 5.
  // The tab and the search go under AND: the profile filter owns the top-level `targets` key (R1219).
  const where = { ...(await filterFor(user, filter)), userId: user.id, AND: [statusWhere(status), ...searchWhere(q)] };
  // A cursor from another workspace (or a deleted post) simply restarts nothing: it must belong to this user.
  const from = cursor ? await db.post.findFirst({ where: { id: cursor, userId: user.id }, select: { id: true } }) : null;
  if (cursor && !from) return { posts: [], views: {}, nextCursor: null };
  const rows = await db.post.findMany({
    where,
    include: { targets: true, media: true, reviews: { orderBy: { createdAt: "desc" } } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: n + 1,
    ...(from ? { cursor: { id: from.id }, skip: 1 } : {}),
  });
  const page = rows.slice(0, n);
  const targetPost = new Map(page.flatMap((p) => p.targets.map((t) => [t.id, p.id] as const)));
  const views: Record<string, number> = {};
  if (targetPost.size) {
    const metrics = await db.targetMetric.groupBy({ by: ["targetId"], where: { targetId: { in: [...targetPost.keys()] } }, _sum: { views: true } });
    for (const m of metrics) {
      const pid = targetPost.get(m.targetId);
      if (pid) views[pid] = (views[pid] ?? 0) + (m._sum.views ?? 0);
    }
  }
  return { posts: await Promise.all(page.map(postView)), views, nextCursor: rows.length > n ? page[page.length - 1].id : null };
}

export async function libraryCounts(user: U, filter?: Filter): Promise<LibraryCounts> {
  const where = { ...(await filterFor(user, filter)), userId: user.id };
  const [groups, archived, deleted, needs_verification] = await Promise.all([
    db.post.groupBy({ by: ["status"], where: { ...where, AND: [ACTIVE_WHERE] }, _count: { _all: true } }),
    db.post.count({ where: { ...where, AND: [ARCHIVED_WHERE] } }),
    db.post.count({ where: { ...where, AND: [DELETED_WHERE] } }),
    db.post.count({ where: { ...where, AND: [NEEDS_VERIFICATION_WHERE] } }),
  ]);
  const c: LibraryCounts = { all: 0, draft: 0, scheduled: 0, published: 0, failed: 0, archived, deleted, needs_verification };
  for (const g of groups) {
    const k = g._count._all;
    c.all += k;
    if (g.status === "draft") c.draft += k;
    else if (g.status === "scheduled") c.scheduled += k;
    else if (g.status === "published") c.published += k;
    else if (g.status === "failed" || g.status === "partial") c.failed += k;
  }
  return c;
}
