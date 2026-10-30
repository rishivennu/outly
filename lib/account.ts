import "server-only";
import { getConfig } from "./settings";
import { db } from "./db";
import { decrypt } from "./crypto";
import { randomBytes } from "node:crypto";
import { env } from "./env";
import { HttpError } from "./http";
import { sbAuth, supabaseConfigured } from "./supabase/server";
import type { SessionUser } from "./auth";
import { hashDeletionToken, newDeletionToken, runCleanups } from "./account-cleanup";
import { cleanupKeys } from "./account-cleanup-core";

/**
 * The creator's own data: take a copy, or delete the studio for good.
 * Both live here rather than in the route so the selects (which must never leak a secret) are
 * unit-tested against a real database.
 */

/** Everything we hold about one creator. Explicit selects only: no password hash, no authenticator
 * secret, no recovery codes, and no platform tokens, so a leaked export cannot be used to sign in or post. */
export async function exportUser(id: string) {
  const [profile, accounts, posts, media, ideas, snippets, subscriptions, invoices, dmThreads] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id },
      select: { id: true, name: true, email: true, avatar: true, timezone: true, postingGoal: true, weeklyReport: true, signupSource: true, referralCode: true, createdAt: true, lastActiveAt: true },
    }),
    db.socialAccount.findMany({
      where: { userId: id },
      select: { platform: true, username: true, displayName: true, status: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    db.post.findMany({
      where: { userId: id },
      select: {
        id: true, mediaId: true, title: true, story: true, hook: true, status: true, scheduledAt: true, publishedAt: true, createdAt: true,
        targets: {
          select: { platform: true, title: true, caption: true, description: true, hashtags: true, platformStatus: true, platformUrl: true, practice: true, publishedAt: true, createdAt: true },
          orderBy: { platform: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.media.findMany({
      where: { userId: id },
      select: { id: true, originalFilename: true, mimeType: true, size: true, duration: true, width: true, height: true, status: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    db.idea.findMany({ where: { userId: id }, select: { text: true, source: true, doneAt: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    db.snippet.findMany({ where: { userId: id }, select: { kind: true, name: true, body: true, uses: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    db.subscription.findMany({
      where: { userId: id },
      select: { status: true, priceMinor: true, currency: true, interval: true, provider: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, canceledAt: true, createdAt: true, plan: { select: { name: true, slug: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.invoice.findMany({
      where: { userId: id },
      select: { number: true, description: true, amountMinor: true, currency: true, issuedAt: true },
      orderBy: { issuedAt: "asc" },
    }),
    // Direct messages (1031): the creator's own conversations, decrypted. Platform ids of the other person are left out.
    db.dmThread.findMany({
      where: { userId: id },
      select: {
        platform: true, participantName: true, participantHandle: true, lastMessageAt: true, createdAt: true,
        account: { select: { username: true } },
        messages: { select: { direction: true, text: true, attachments: true, sentAt: true }, orderBy: { sentAt: "asc" } },
      },
      orderBy: { lastMessageAt: "desc" },
    }),
  ]);
  const plain = (v: string) => {
    try {
      return decrypt(v);
    } catch {
      return "";
    }
  };
  const directMessages = dmThreads.map((t) => ({
    platform: t.platform,
    account: t.account.username,
    with: t.participantName ?? t.participantHandle ?? null,
    handle: t.participantHandle,
    lastMessageAt: t.lastMessageAt,
    createdAt: t.createdAt,
    messages: t.messages.map((m) => ({ direction: m.direction, text: plain(m.text), attachments: m.attachments ? (JSON.parse(m.attachments) as unknown) : [], sentAt: m.sentAt })),
  }));
  return { exportedAt: new Date().toISOString(), app: "Outlly", profile, accounts, posts, media, ideas, snippets, subscriptions, invoices, directMessages };
}

/**
 * Delete the studio. Everything that hangs off the User row goes with it (the schema cascades) and the
 * uploaded files are removed afterwards. Invoices are the one exception: tax law needs them, so they are
 * detached (no user, no payment row, detachedAt set) and the retention cron deletes them once
 * INVOICE_KEEP_YEARS have passed (lib/retention/prune.ts). The Supabase auth user is deleted FIRST, so the password stops
 * working even if the row delete were to fail. A teammate inside someone else's workspace is refused.
 */
export async function deleteAccount(user: Pick<SessionUser, "id" | "actor">, confirm: string) {
  if (user.actor) throw new HttpError(403, "You're in someone else's studio. Switch back to your own to delete it.", "NOT_OWNER");
  const me = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { id: true, email: true, authId: true } });
  if (confirm.trim().toLowerCase() !== me.email.toLowerCase()) throw new HttpError(400, "That email doesn't match the one on this account.", "CONFIRM");

  if (env.AUTH_PROVIDER === "supabase" && supabaseConfigured() && me.authId) {
    try {
      await sbAuth.deleteUser(me.authId);
    } catch (e) {
      console.error("[account:delete] supabase auth user", e);
      throw new HttpError(502, "We couldn't finish deleting the account. Try again in a minute.", "AUTH_DELETE");
    }
  }
  const media = await db.media.findMany({ where: { userId: me.id }, select: { storageKey: true, thumbnailKey: true } });
  const now = new Date();
  // Older invoices predate the snapshot columns: fill them in now (gateway from the payment row, which is
  // about to go; tax rate and seller from today's settings), so the kept copy stops changing with settings.
  const legacy = await db.invoice.findMany({
    where: { userId: me.id, OR: [{ provider: null }, { taxPercent: null }, { issuer: null }] },
    select: { id: true, provider: true, providerRef: true, taxPercent: true, issuer: true, payment: { select: { provider: true, providerRef: true } } },
  });
  const biz = legacy.length ? (await getConfig("payments")).business : null;
  // 1053: every uploaded object gets a durable cleanup row, written in the SAME transaction that deletes the
  // account, so a crash can never leave files nobody will remove. The person keeps a status link (the token).
  const keys = cleanupKeys(media);
  const token = newDeletionToken();
  const deletionId = `del_${randomBytes(12).toString("base64url")}`; // never derived from the token
  await db.$transaction([
    db.accountDeletion.create({
      data: {
        id: deletionId,
        tokenHash: hashDeletionToken(token),
        filesTotal: keys.length,
        ...(keys.length === 0 ? { status: "done", finishedAt: now } : {}),
        files: { create: keys.map((key) => ({ key })) },
      },
    }),
    ...legacy.map((i) =>
      db.invoice.update({
        where: { id: i.id },
        data: {
          provider: i.provider ?? i.payment?.provider ?? null,
          providerRef: i.providerRef ?? i.payment?.providerRef ?? null,
          taxPercent: i.taxPercent ?? biz?.taxPercent ?? 0,
          issuer: i.issuer ?? JSON.stringify({ name: biz?.name || "Outlly", address: biz?.address || "", gstin: biz?.gstin || "" }),
        },
      }),
    ),
    db.invoice.updateMany({ where: { userId: me.id }, data: { detachedAt: now } }),
    db.user.delete({ where: { id: me.id } }), // the schema sets the invoices' userId and paymentId to null
  ]);
  // Files last, and only as a head start: whatever doesn't finish in a few seconds, or fails, is retried
  // with backoff by the minute sweeper until the bucket confirms it's gone.
  if (keys.length) await runCleanups({ deletionId, budgetMs: 3_000, limit: 200 }).catch((e) => console.error("[account:delete] cleanup", e));
  return { ok: true as const, status: token };
}
