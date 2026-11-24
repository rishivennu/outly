import "server-only";
import { HttpError } from "../http";
import type { SessionUser } from "../auth";
import { CLIENT_KEY_MAX } from "../../components/intelligence/view-core";
import { accountIdsForClient, getBrandProfile } from "./memory";
import { db } from "../db";

/**
 * R1319: the ?client= rule every intelligence route shares. Only the owner switches clients; a client key must name
 * a stored brand profile; the client's destinations are the targets on the accounts it owns (empty when none).
 */
export async function resolveClient(user: Pick<SessionUser, "id" | "role">, client: string | null): Promise<{ scopeKey: string; targetIds: string[] | null }> {
  if (!client) return { scopeKey: "", targetIds: null };
  if (user.role !== "owner") throw new HttpError(403, "Only the workspace owner can switch clients.", "OWNER_ONLY");
  if (client.length > CLIENT_KEY_MAX) throw new HttpError(400, "That client key is too long.", "BAD_CLIENT");
  if (!(await getBrandProfile(user.id, client))) throw new HttpError(404, "That client profile no longer exists.", "NO_CLIENT");
  const accountIds = (await accountIdsForClient(user.id, client)) ?? [];
  return { scopeKey: client, targetIds: await targetIdsForAccounts(user.id, accountIds) };
}

/**
 * The published destinations on a set of the owner's accounts, newest first, at most 3000: the one way a client or a
 * scoped teammate (R1325 Pip) is narrowed, so both read the same subset. Empty accounts give [] (nothing), never null (everything).
 */
export async function targetIdsForAccounts(ownerId: string, accountIds: readonly string[]): Promise<string[]> {
  if (!accountIds.length) return [];
  const ts = await db.postTarget.findMany({ where: { post: { userId: ownerId }, socialAccountId: { in: [...accountIds] }, platformStatus: "published" }, select: { id: true }, orderBy: { publishedAt: "desc" }, take: 3000 });
  return ts.map((t) => t.id);
}
