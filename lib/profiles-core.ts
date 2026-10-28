/**
 * Pro Multi-Account Manager (1037): pure rules for profiles (connected accounts), so they are unit-tested
 * without a database. A "scope" is the list of account ids a team member may work on; null = every account.
 */

export type Scope = string[] | null;

/** Max account ids kept on one seat; more than the biggest plan allows, so it never truncates real data. */
export const SCOPE_MAX = 50;

/**
 * TeamMember.accountIds is JSON; null/empty column = every account. Anything unreadable fails closed (no
 * accounts), so a damaged value can never widen what a member sees.
 */
export function parseScope(raw: string | null | undefined): Scope {
  if (raw == null || raw === "") return null;
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 40))].slice(0, SCOPE_MAX);
  } catch {
    return [];
  }
}

export const inScope = (scope: Scope, accountId: string | null | undefined) => scope === null || (!!accountId && scope.includes(accountId));

/**
 * May someone with `scope` open this post? Every destination already tied to an account must be one of theirs.
 * Destinations not tied to an account yet (an old draft) don't block; they get an in-scope account at launch.
 */
export function postInScope(targets: { socialAccountId: string | null }[], scope: Scope) {
  if (scope === null) return true;
  return targets.every((t) => t.socialAccountId === null || scope.includes(t.socialAccountId));
}

/**
 * Prisma `where` for posts shown under a profile filter. `active` = the one profile picked on Home, `scope` =
 * what a member may see. Posts are matched through the accounts their destinations are tied to.
 */
export function postAccountWhere(active: string | null, scope: Scope, unpinnedPlatform: string | null = null) {
  if (!active && scope === null) return {};
  // Older destinations carry no account yet. They go out on the platform's default account, so when the picked
  // profile IS that default (unpinnedPlatform), they belong to it too.
  const some = active
    ? unpinnedPlatform
      ? { OR: [{ socialAccountId: active }, { socialAccountId: null, platform: unpinnedPlatform }] }
      : { socialAccountId: active }
    : { socialAccountId: { in: scope as string[] } };
  // A member never sees a post that also goes to an account outside their scope. NOT IN skips NULLs, so
  // destinations without an account yet don't count against it.
  return scope === null ? { targets: { some } } : { targets: { some, none: { socialAccountId: { notIn: scope } } } };
}

export type ProfileLike = { id: string; platform: string; username: string; displayName: string | null; status: string; createdAt: Date | string };

/**
 * Which account a destination goes out on. A destination tied to an account keeps it; otherwise the active
 * profile when it's on that platform; otherwise the first connected account on the platform the person may use.
 */
export function pickAccount<A extends ProfileLike>(platform: string, pinned: string | null, accounts: A[], scope: Scope, active: string | null = null): A | null {
  const usable = accounts.filter((a) => a.platform === platform && inScope(scope, a.id));
  if (pinned) {
    const p = accounts.find((a) => a.id === pinned && a.platform === platform);
    if (p) return inScope(scope, p.id) ? p : null;
  }
  const act = active ? usable.find((a) => a.id === active) : undefined;
  if (act) return act;
  const sorted = [...usable].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  return sorted.find((a) => a.status === "connected") ?? sorted[0] ?? null;
}

/** Search box on the profile panel: username, display name or platform, case and @ insensitive. */
export function matchProfile(p: Pick<ProfileLike, "username" | "displayName" | "platform">, q: string) {
  const s = q.trim().toLowerCase().replace(/^@/, "");
  if (!s) return true;
  return [p.username.replace(/^@/, ""), p.displayName ?? "", p.platform].some((v) => v.toLowerCase().includes(s));
}

/** "Online" for a profile = connected and its token not past expiry: we can post to it right now. */
export function profileOnline(a: { status: string; tokenExpiresAt?: Date | string | null; refreshToken?: string | null }, now = Date.now()) {
  if (a.status !== "connected") return false;
  if (!a.tokenExpiresAt || a.refreshToken) return true;
  return +new Date(a.tokenExpiresAt) > now;
}
