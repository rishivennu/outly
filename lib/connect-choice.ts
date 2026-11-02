import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { decrypt, encrypt } from "./crypto";
import { isPlatform, type Platform } from "./domain";
import type { ConnectedProfile } from "./social/types";
import type { ConnectDecision, ConnectIntent, KnownAccount } from "./connect-decision";
import { decideConnect, pickIdentity } from "./connect-decision";
import { entitlements } from "./billing/entitlements";

/*
 * A connect that needs the creator's say (1095): the platform handed back an account this studio has seen
 * before, or one that would replace the current account. Nothing is saved yet. The profile (tokens included)
 * waits here encrypted, bound to the user, for 15 minutes; the Accounts page asks, and only an explicit
 * "Reconnect" or "Replace" saves it. Every other answer, or no answer, throws it away.
 */
const PREFIX = "connect-choice:";
const TTL_MS = 15 * 60_000;
export const CHOICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface Choice {
  uid: string;
  platform: Platform;
  prof: ConnectedProfile;
  decision: Exclude<ConnectDecision, { kind: "save" }>;
}

/** What the page may see: names and the question. Never a token. */
export interface ChoiceView {
  id: string;
  platform: Platform;
  account: { username: string; displayName: string | null; avatar: string | null };
  decision: Choice["decision"];
}

const sweep = () => db.setting.deleteMany({ where: { key: { startsWith: PREFIX }, updatedAt: { lt: new Date(Date.now() - TTL_MS) } } }).catch(() => {});

/** The accounts this studio already has on the platform, in any state, for decideConnect. */
export async function knownAccounts(userId: string, platform: Platform): Promise<KnownAccount[]> {
  return db.socialAccount.findMany({ where: { userId, platform }, select: { id: true, platformUserId: true, status: true, username: true }, orderBy: { createdAt: "asc" } });
}

/**
 * Pick which identity of the sign-in to use, then decide. `alternatives` (other Facebook Pages, with their
 * tokens) never leave this function: only the chosen identity is held or saved.
 */
export async function resolveConnect(userId: string, platform: Platform, raw: ConnectedProfile, intent: ConnectIntent, expectId?: string | null) {
  const rows = await knownAccounts(userId, platform);
  const { alternatives, ...first } = raw;
  const prof = pickIdentity<ConnectedProfile>(first, (alternatives ?? []).map(({ alternatives: _drop, ...p }) => p), rows, intent, expectId);
  const multi = (await entitlements(userId)).accountLimit > 0;
  return { prof, decision: decideConnect({ rows, platformUserId: prof.platformUserId, intent, expectId, multi }) };
}

export async function holdChoice(c: Choice): Promise<string> {
  const id = randomUUID();
  await sweep();
  await db.setting.create({ data: { key: PREFIX + id, value: encrypt(JSON.stringify(c)) } });
  return id;
}

async function read(id: string, uid: string) {
  if (!CHOICE_ID.test(id)) return null;
  const row = await db.setting.findUnique({ where: { key: PREFIX + id } });
  if (!row || Date.now() - row.updatedAt.getTime() > TTL_MS) return null;
  try {
    const c = JSON.parse(decrypt(row.value)) as Choice;
    if (c.uid !== uid || !isPlatform(c.platform)) return null;
    if (c.prof.expiresAt) c.prof.expiresAt = new Date(c.prof.expiresAt);
    return { c, updatedAt: row.updatedAt };
  } catch {
    return null;
  }
}

export async function viewChoice(id: string, uid: string): Promise<ChoiceView | null> {
  const r = await read(id, uid);
  if (!r) return null;
  const { prof, platform, decision } = r.c;
  return { id, platform, account: { username: prof.username, displayName: prof.displayName ?? null, avatar: prof.avatar ?? null }, decision };
}

/** Once, for the same user only. A second click (or another tab) gets null. */
export async function takeChoice(id: string, uid: string): Promise<Choice | null> {
  await sweep();
  const r = await read(id, uid);
  if (!r) return null;
  const gone = await db.setting.deleteMany({ where: { key: PREFIX + id, updatedAt: r.updatedAt } });
  return gone.count === 1 ? r.c : null;
}
