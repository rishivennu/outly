import "server-only";
import { db } from "../db";
import { accountTargetId, forgetComments } from "../inbox";
import { isPracticeAccount } from "../social/registry";
import { noticeNewComment } from "../notify-events";
import type { CommentEvent } from "./webhook";

/**
 * 1136: comments arriving on the Meta webhook (lib/messages/webhook.ts parseCommentWebhook).
 *
 * Nothing is stored: Inbox reads comments from the platform itself, so a webhook only has to say
 * "this post changed" (the cached copy is dropped) and raise the notification. That keeps the webhook
 * fast enough for Meta's 20-second budget and means a comment can never be shown twice from two sources.
 *
 * Idempotent: Meta retries the same delivery, and `noticeNewComment` keys the notice by comment id, so a
 * retry writes nothing. The same Instagram account or Page may be connected by more than one workspace,
 * so each owner is told separately.
 */
export async function ingestComments(events: CommentEvent[]) {
  let notified = 0;
  let skipped = 0;
  for (const ev of events) {
    const accts = await db.socialAccount.findMany({ where: { platform: ev.platform, platformUserId: ev.accountPlatformId, status: "connected" } });
    if (!accts.length) {
      skipped++;
      continue;
    }
    for (const acct of accts) {
      // Practice accounts are sample data: a real webhook for one would be someone else's account.
      if (isPracticeAccount(acct)) continue;
      // Published through Outlly? Then the inbox target is that destination, and we know the post's name.
      const target = await db.postTarget.findFirst({
        where: { platformPostId: ev.mediaId, platform: ev.platform, socialAccountId: acct.id, post: { userId: acct.userId } },
        select: { id: true, post: { select: { title: true, hook: true } } },
      });
      const targetId = target?.id ?? accountTargetId(acct.id, ev.mediaId);
      const postTitle = target ? (target.post.title || target.post.hook?.split("\n")[0] || null) : null;
      // A reply inside a thread is answered on its parent comment; a top-level one on itself.
      await noticeNewComment(acct.userId, {
        accountId: acct.id,
        platform: ev.platform,
        commentId: ev.commentId,
        replyTo: ev.parentId ?? ev.commentId,
        mediaId: ev.mediaId,
        targetId,
        postTitle,
        from: ev.fromName,
        text: ev.text,
      });
      // The next Inbox load must read the platform again, or the new comment would not be there.
      forgetComments(acct.id, targetId);
      notified++;
    }
  }
  return { notified, skipped };
}
