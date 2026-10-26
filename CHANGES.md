# fix-1027-queue-hardening

Upload AFTER fix-1026b-email and fix-1026e-delete-env (this bundle replaces
tests/round-1026e-delete-order.test.ts from 1026e). 15 files. No schema change,
no `prisma db push` needed.

## Posting queue
- **Stuck targets recover.** The cron sweep now also picks up targets stuck in
  `uploading` (15 min with no progress: restart the upload, give up after 6
  restarts) and `processing` (10 min: re-check status if the publish call was
  made, else re-run the publish; give up after 3 h). Each pickup is a
  conditional claim, so two sweepers never requeue the same target twice and a
  post is never published twice. A running upload touches its row every
  60 s, so a slow but live upload is never restarted. (lib/queue/handlers.ts)
- **A settled target stays settled.** `setTarget` never overwrites
  `published`, and a late failure never replaces the creator's Stop. A failure
  that changed nothing sends no notice.
- **Jobs survive on Vercel.** In-process jobs are held open with Vercel's
  `waitUntil`, and the cron sweep waits up to 45 s for them (`settle`) before
  answering (the time left of its 60 s, minus 10 s headroom). The JSON reply
  now includes `running`. (lib/queue/index.ts,
  app/api/cron/sweep/route.ts)
- Errors while loading a job (DB hiccup, pool timeout) are retried with the
  normal caps instead of leaving the target stuck or failing it outright.
  A refused token still fails it with "reconnect".

## Tokens
- Token refresh is single-flight per account and re-reads the row first, so
  two jobs never rotate the same refresh token at once (lib/live/account.ts).
- A refused refresh now shows as **AUTH_EXPIRED / reconnect** (it used to show
  "media rejected"). A network blip stays retryable and leaves the account alone.
- The sweeper refreshes only tokens that expire within 30 min, once per 10 min.

## Security / spend
- Sign out everywhere uses the real user id (it used the studio owner's id
  for teammates).
- Login is rate-limited per email too (20 failed tries per hour), not only
  per IP. Successful sign-ins don't count, so nobody can lock the owner out
  by signing in for them.
- Signed-out help chat: AI answers capped per IP (default 15/day) and in
  total (default 300/day); past the cap Pip answers from the help centre.
  Optional env: `AI_SUPPORT_ANON_PER_IP`, `AI_SUPPORT_ANON_DAILY`. Only
  messages that reach the model count; tapping an English help question is
  free for everyone (signed-in people's daily counter included).

## Billing
- Changing plan keeps the paid time left (converted at the new price, never
  more than the days actually left). Free, sample or other-currency periods
  carry nothing over.
- A payment confirmed twice still gets its invoice if the first run missed it.
- A failed AI caption transcription gives the caption-video slot back.
- `ensurePlans` on a fresh database records the free-plan migration, so
  admin edits are not overwritten later.

## Tests
- New tests/round-1027-queue.test.ts (22 tests).
- round-1026e env test now really checks the env fallback for every platform.
- Full suite: 562 pass, 0 fail. tsc clean. next build ok. Reviewed twice
  (akisa), no open issues.

## After uploading
- The cron pinger (cron-job.org hitting /api/cron/sweep with CRON_SECRET,
  every 1-5 min) matters even more now: it is what recovers stuck posts.
