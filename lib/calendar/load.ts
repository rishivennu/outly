import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { postFilter } from "@/lib/profiles";
import { inScope, type Scope } from "@/lib/profiles-core";
import { postView, type PostView } from "@/lib/services";
import type { AccountState } from "@/lib/posts/attention";
import { DRAFTS_PAGE, UPCOMING_PAGE } from "./range";

type U = Parameters<typeof postFilter>[0];

/** A post as the calendar holds it: the shared view plus what "Requires attention" needs and PostView leaves out. */
export type CalendarPost = PostView & { accountIds: Record<string, string | null>; slideCount: number };

const INCLUDE = { targets: true, media: true, reviews: { orderBy: { createdAt: "desc" } }, _count: { select: { items: true } } } satisfies Prisma.PostInclude;
type Row = Prisma.PostGetPayload<{ include: typeof INCLUDE }>;

async function view(rows: Row[]): Promise<CalendarPost[]> {
  return Promise.all(
    rows.map(async (r) => ({
      ...(await postView(r)),
      accountIds: Object.fromEntries(r.targets.map((t) => [t.id, t.socialAccountId])),
      slideCount: r._count.items,
    })),
  );
}

async function scoped(user: U, extra: Prisma.PostWhereInput): Promise<Prisma.PostWhereInput> {
  const { where } = await postFilter(user);
  // R1219: an archived post is out of the active views; the calendar is one.
  return { AND: [{ userId: user.id, archivedAt: null }, where, extra] };
}

/** The accounts a post can go out on, without tokens: enough to tell whether it still can. A scoped member sees only theirs. */
export async function accountStates(userId: string, scope: Scope = null): Promise<AccountState[]> {
  const rows = await db.socialAccount.findMany({
    where: { userId },
    select: { id: true, platform: true, status: true, tokenExpiresAt: true, refreshToken: true },
    orderBy: { createdAt: "asc" },
  });
  // Same rule as profileOnline: an account with a refresh token renews itself, so its expiry is not a deadline.
  return rows.filter((a) => inScope(scope, a.id)).map((a) => ({ id: a.id, platform: a.platform, status: a.status, expiresAt: a.refreshToken || !a.tokenExpiresAt ? null : a.tokenExpiresAt.toISOString() }));
}

/** Most posts one range returns. A month of a very busy studio still fits; past this the grid would be unreadable anyway. */
export const RANGE_CAP = 400;

/** Everything placed in [from, to): booked there, or (never booked) went out there. `truncated`: there were more than RANGE_CAP. */
export async function loadRangePage(user: U, from: Date, to: Date): Promise<{ posts: CalendarPost[]; truncated: boolean }> {
  const rows = await db.post.findMany({
    where: await scoped(user, { OR: [{ scheduledAt: { gte: from, lt: to } }, { scheduledAt: null, publishedAt: { gte: from, lt: to } }] }),
    include: INCLUDE,
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    take: RANGE_CAP + 1,
  });
  return { posts: await view(rows.slice(0, RANGE_CAP)), truncated: rows.length > RANGE_CAP };
}

export async function loadRange(user: U, from: Date, to: Date): Promise<CalendarPost[]> {
  return (await loadRangePage(user, from, to)).posts;
}

type Page = { posts: CalendarPost[]; nextCursor: string | null };

async function paged(user: U, extra: Prisma.PostWhereInput, orderBy: Prisma.PostOrderByWithRelationInput[], cursor: string | null, take: number, cap: number): Promise<Page> {
  const n = Math.max(1, Math.min(cap, Math.floor(take) || cap));
  // A cursor from another account (or a deleted post) never pages into someone else's posts.
  const from = cursor ? await db.post.findFirst({ where: { id: cursor, userId: user.id }, select: { id: true } }) : null;
  if (cursor && !from) return { posts: [], nextCursor: null };
  const rows = await db.post.findMany({ where: await scoped(user, extra), include: INCLUDE, orderBy, take: n + 1, ...(from ? { cursor: { id: from.id }, skip: 1 } : {}) });
  const page = rows.slice(0, n);
  return { posts: await view(page), nextCursor: rows.length > n ? page[page.length - 1].id : null };
}

/** Booked from now on, soonest first, a page at a time. */
export function loadUpcoming(user: U, cursor: string | null = null, take = UPCOMING_PAGE, now = new Date()) {
  return paged(user, { scheduledAt: { gte: now }, status: { notIn: ["published"] } }, [{ scheduledAt: "asc" }, { id: "asc" }], cursor, take, UPCOMING_PAGE);
}

/** Drafts with no date: they live in a tray, never on a day. */
export function loadUnscheduled(user: U, cursor: string | null = null, take = DRAFTS_PAGE) {
  return paged(user, { status: "draft", scheduledAt: null }, [{ updatedAt: "desc" }, { id: "desc" }], cursor, take, DRAFTS_PAGE * 3);
}
