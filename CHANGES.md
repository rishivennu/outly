# fix-1032b: smarter retries, sweeper health warning, liquid glass

Upload order: repo-sync-1027 (1031e), then fix-1031fg-dm-switch-security, then fix-1032a-partial-resend, then this one.
This bundle's copies of lib/queue/handlers.ts, app/api/cron/sweep/route.ts and tests/publishing.test.ts already
contain the 1031fg and 1032a changes, so they replace those files.

## Smarter retries
- Retries: 5 instead of 3, waiting about 2 s, 10 s, 30 s, 2 min and 5 min (was 1.5 / 3 / 6 s, so a one-minute
  platform hiccup used up every retry and failed the post). Each wait has +-15% jitter so many posts throttled
  together don't all come back in the same second.
- The platform's own wait is honoured as the minimum: Retry-After (seconds or date), X's x-rate-limit-reset,
  and Meta's estimated_time_to_regain_access in its usage headers.
- If a platform asks for more than 20 minutes (a spent daily quota) the post fails right away and says so,
  instead of hanging.
- Meta throttles arrive as HTTP 400/403 with codes 4, 17, 32, 613, 80001-80014. They used to be read as
  "Media rejected" (no retry), and a 403 one could wrongly flag the account for reconnection. Now RATE_LIMITED
  and retried. Meta's is_transient:true is now PLATFORM_DOWN and retried. X's code 32 is unaffected.
- On Vercel (no Redis) a wait longer than 40 s can't be a timer, so the target is parked as "queued" and the
  minute sweep sends it again when the wait is over. Stop and late successes still win.
- Status checks back off (3 s growing to 30 s, at least the platform's Retry-After) instead of a flat 3 s.

## Sweeper health warning
- Every sweep (cron pinger, Redis worker, in-process) records when it ran (Setting sweeper:last:<source>).
- The Redis worker now also recovers stuck targets each tick, like the cron route already did.
- Admin panel (super admins): a warning appears when the sweep this deployment relies on hasn't run for
  3 minutes, with the number of overdue scheduled posts and what to check (cron-job.org pinger for
  /api/cron/sweep with the CRON_SECRET bearer token). It also shows right after a fresh deploy until the
  first ping arrives.

## Liquid glass
- New components/shared/LiquidGlass.tsx (edge refraction with chromatic fringe, Chromium only; other
  browsers keep frosted glass). Used on the sidebar, mobile tab bar, toasts and sheets.
- Dark glass tint raised and its backdrop dimmed so muted sidebar labels stay at least 4.5:1 on a busy
  background. Reduced transparency, increased contrast and forced colours fall back to solid surfaces.

## Tests
- New tests/round-1028-retries.test.ts; publishing and 1027 queue tests updated for the new schedule.
