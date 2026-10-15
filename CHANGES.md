# fix-1015-retention (upload AFTER fix-1014-perf and fix-1015-features)

Copy every file into the REPO ROOT, keeping the folders. 106 files, cumulative since fix-1015-features.

## Before or right after deploying
1. `prisma db push` against production (new: User.postingGoal/nudgeAt/winbackAt/signupSource/totpSecret/totpEnabledAt/totpLastStep/recoveryCodes, Subscription.pausedUntil, models Notice, Snippet, Idea, OtpCode).
2. Vercel env: `CRON_SECRET` (daily retention cron in vercel.json), `GEMINI_API_KEY` (already needed).
3. Email provider must be Resend in Admin > Email for sign-in codes to reach real inboxes. In production, while the provider is still Mock, "Email me a code" answers "not switched on yet" instead of parking live codes in the Outbox.
4. Rate limits are in memory (per server instance). Fine for one instance; move them to Redis before scaling out.

## What's in it
- Retention: posting goal ring, idea bank, recycle card, next steps, notices bell, snippets, PWA share target, daily cron (nudges, win-backs, notices).
- Billing: pause 1 to 3 months instead of cancelling, resume any time.
- Admin: "At risk" page (one-click win-back), "Growth" page (funnel, lead lists with email + CSV, campaign link builder, channel table, referral board), marketing role.
- Signup source: first-touch utm cookie stored as User.signupSource.
- Sign-in codes by email: "Email me a sign-in code instead" on /login. 6 digits, hashed, 10 min, 5 tries, single use, 1 per minute and 5 per hour per address, same answer for unknown addresses. The code is masked in the Outbox copy whenever a real provider sent it, and always in production. A failed delivery is logged and gives the same answer, so it can't reveal which addresses have accounts.
- Two-step sign-in (authenticator app, TOTP RFC 6238): Settings > Two-step sign-in. QR drawn in the page (no QR service), 10 one-time recovery codes, replay protection, 6 wrong codes per 15 minutes. Applies after password, email code and Google sign-in. The halfway step is a 5-minute signed cookie that dies once any code is spent or 2FA is reset; "Start over" clears it (DELETE /api/auth/2fa). Turning it on or off, and new recovery codes, each send a security email.
- SMS: `lib/otp/channel.ts` has an `smsChannel` stub. Needs a DLT-registered SMS provider (India) before it can send.
- Tests: tests/round-1015-*.test.ts.
