import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "./db";
import { HttpError } from "./http";
import { getCurrentUser, type SessionUser } from "./auth";
import { WS_COOKIE } from "./team/roles";
import { isPlatform, type Platform } from "./domain";
import { isPracticeAccount } from "./social/registry";
import { inScope, pickAccount, postAccountWhere, postInScope, profileOnline, type Scope } from "./profiles-core";

/**
 * Pro Multi-Account Manager (1037). A "profile" is one connected account. The one picked on Home lives in
 * this cookie (a SocialAccount id), so it survives reloads and new tabs; it is only trusted after it is
 * checked against the accounts this person may see in this workspace.
 */
export const ACCT_COOKIE = "ol_acct";

export type ProfileView = {
  id: string;
  platform: Platform;
  username: string;
  displayName: string | null;
  avatar: string | null;
  status: string;
  online: boolean;
  mock: boolean;
  scheduled: number;
};

/** Profiles this person may work on, oldest first. One query for the accounts, one for scheduled counts. */
export const listProfiles = cache(async (ownerId: string, scope: Scope): Promise<ProfileView[]> => {
  const rows = await db.socialAccount.findMany({
    where: { userId: ownerId, status: { not: "disconnected" }, ...(scope ? { id: { in: scope } } : {}) },
    orderBy: { createdAt: "asc" },
  });
  const accts = rows.filter((a) => isPlatform(a.platform));
  if (!accts.length) return [];
  const counts = await db.postTarget.groupBy({
    by: ["socialAccountId"],
    where: { socialAccountId: { in: accts.map((a) => a.id) }, post: { status: "scheduled" } },
    _count: { _all: true },
  });
  const n = new Map(counts.map((c) => [c.socialAccountId, c._count._all]));
  return accts.map((a) => ({
    id: a.id,
    platform: a.platform as Platform,
    username: a.username,
    displayName: a.displayName,
    avatar: a.avatar,
    status: a.status,
    online: profileOnline(a),
    mock: isPracticeAccount(a),
    scheduled: n.get(a.id) ?? 0,
  }));
});

/** The picked profile, if it is still one this person may see. Null = all profiles. */
export async function activeProfile(user: Pick<SessionUser, "id" | "scope">, list?: ProfileView[]) {
  const id = cookies().get(ACCT_COOKIE)?.value;
  if (!id) return null;
  const all = list ?? (await listProfiles(user.id, user.scope));
  return all.find((p) => p.id === id) ?? null;
}

/** Prisma filter for posts under the current profile pick and member scope. */
export async function postFilter(user: Pick<SessionUser, "id" | "scope">) {
  const list = await listProfiles(user.id, user.scope);
  const active = await activeProfile(user, list);
  // listProfiles is oldest first, so the first connected one on a platform is its default (see pickAccount).
  const isDefault = !!active && (list.find((p) => p.platform === active.platform && p.status === "connected") ?? list.find((p) => p.platform === active.platform))?.id === active.id;
  return { active, where: postAccountWhere(active?.id ?? null, user.scope, isDefault ? active!.platform : null), accountIds: active ? [active.id] : user.scope };
}

/**
 * The scope of whoever is making this request, when they act inside `ownerId`'s workspace as a member.
 * Owners, background jobs and tests get null (no restriction), and pay nothing: without the workspace
 * cookie there is no lookup at all.
 */
export async function requestScope(ownerId: string): Promise<Scope> {
  let ws: string | undefined;
  try {
    ws = cookies().get(WS_COOKIE)?.value;
  } catch {
    return null; // not inside a request (worker, script)
  }
  if (!ws || ws !== ownerId) return null;
  const u = await getCurrentUser();
  return u && u.id === ownerId ? u.scope : null;
}

/** Throws the same 404 as a missing post, so a member can't probe for posts outside their accounts. */
export async function assertPostScope(ownerId: string, targets: { socialAccountId: string | null }[]) {
  const scope = await requestScope(ownerId);
  if (!postInScope(targets, scope)) throw new HttpError(404, "We couldn't find that post.");
  return scope;
}

const ownAccounts = (ownerId: string) => db.socialAccount.findMany({ where: { userId: ownerId, status: { not: "disconnected" } }, orderBy: { createdAt: "asc" } });

/**
 * Which account each destination of a saved post is tied to. Returns only the changes: a destination that
 * already has an account keeps it unless the client named another. A new one takes the active profile on its
 * platform; a member limited to some accounts always gets one of theirs (or a 403 when they have none there).
 * Owners with nothing picked stay untied, and launch uses the platform default, exactly as before 1037.
 */
export async function pinTargets(user: Pick<SessionUser, "id" | "scope">, wants: { platform: string; accountId?: string | null }[], existing: Record<string, string | null>) {
  const active = await activeProfile(user);
  const need = wants.some((w) => w.accountId || (!existing[w.platform] && (user.scope || active?.platform === w.platform)));
  if (!need) return {} as Record<string, string>;
  const all = await ownAccounts(user.id);
  const out: Record<string, string> = {};
  for (const w of wants) {
    if (w.accountId) {
      const a = all.find((x) => x.id === w.accountId && x.platform === w.platform);
      if (!a || !inScope(user.scope, a.id)) throw new HttpError(403, "That account isn't one you can post to here.", "ROLE");
      out[w.platform] = a.id;
      continue;
    }
    if (existing[w.platform]) continue;
    if (active && active.platform === w.platform) {
      out[w.platform] = active.id;
      continue;
    }
    if (user.scope) {
      const a = pickAccount(w.platform, null, all, user.scope);
      if (!a) throw new HttpError(403, "You don't have access to an account on that platform here. Ask the owner to share one with you.", "ROLE");
      out[w.platform] = a.id;
    }
  }
  return out;
}

/**
 * One account per platform for the composer: the one each destination will go out on. The composer was
 * built around one account per platform, so it keeps working unchanged with several.
 */
export async function composerAccounts(user: Pick<SessionUser, "id" | "scope">, pinned: Record<string, string | null> = {}) {
  const [all, active] = await Promise.all([ownAccounts(user.id), activeProfile(user)]);
  const out = [];
  for (const platform of new Set(all.map((a) => a.platform))) {
    const a = pickAccount(platform, pinned[platform] ?? null, all, user.scope, active?.id ?? null);
    if (a) out.push(a);
  }
  return out;
}

/**
 * Accounts the analytics should cover. `drill` (one account id from the drilldown) wins when this person may
 * see it; then the profile picked on Home; then a member's own accounts; null = the whole workspace.
 */
export async function analyticsScope(user: Pick<SessionUser, "id" | "scope">, drill?: string | null): Promise<string[] | null> {
  if (drill) {
    const p = (await listProfiles(user.id, user.scope)).find((x) => x.id === drill);
    if (p) return [p.id];
  }
  return (await postFilter(user)).accountIds;
}

/**
 * Which account a platform's live dashboard shows: the picked profile when it's on that platform, else a
 * member's first account there. Null = the platform default, as before 1037. A member with no account on the
 * platform gets "none" (an id that matches nothing), so they never see the owner's other numbers.
 */
export async function dashboardAccount(user: Pick<SessionUser, "id" | "scope">, platform: string): Promise<string | null> {
  const list = await listProfiles(user.id, user.scope);
  const active = await activeProfile(user, list);
  if (active?.platform === platform) return active.id;
  if (!user.scope) return null;
  return list.find((p) => p.platform === platform)?.id ?? "none";
}
