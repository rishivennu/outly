# outlly-all-1026b-to-1030: one upload of every pending fix

This contains fix-1026b, 1026e, 1027, 1028, 1029 and 1030, already merged (each file is the newest tested version).
Copy everything over the repo at the same paths and commit once. Vercel then redeploys.

## After the deploy (in this order)
1. Run `prisma db push` on the production DB. It adds the PushDevice table and the 1026/1027 columns.
2. On Vercel, set APP_URL=https://outly-ecru.vercel.app if it is not set yet. FCM_SERVICE_ACCOUNT is optional (push).
3. Open the Android app again. It now loads the native app UI.

---

# fix-1026b-email: unsubscribe for marketing email, separate marketing sender, sitemap/robots

Upload AFTER outlly-all-1016-to-1026d (already live). Copy every file to the same path, replacing the old one.
12 files, 2 of them new pages/routes. Nothing to delete. No database change (the EmailOptOut table went
live with fix-1026c).

## What changes
- Marketing email (nudges, win-back, growth campaigns, weekly report) now has an "Unsubscribe" link in the
  footer AND the one-click headers Gmail/Yahoo require from bulk senders (List-Unsubscribe +
  List-Unsubscribe-Post). Gmail shows an "Unsubscribe" button next to the sender name.
- Account email (sign-in codes, security alerts, receipts, support replies, team invites) never gets the
  link and is never blocked.
- New page /unsubscribe: shows the (masked) address, asks before unsubscribing (mail scanners open links,
  so a GET never unsubscribes), and offers "I didn't mean to" to undo. Works in waitlist and maintenance mode.
- Leaving "weekly report" turns off the same switch as Settings. Leaving "tips and product emails" is kept
  per address, so it also covers growth leads without an account.
- Skipped sends show in Admin > Email outbox as "skipped: Unsubscribed from ...".
- Admin > Integrations > Email: new "Marketing from" field (e.g. Outlly <hi@news.outlly.com>). Empty = use From.
- sitemap.xml now lists /help. robots.txt also hides /admin, /inbox, /billing, /unsubscribe, review and team links.

## Set these up
1. Vercel env APP_URL = https://outly-ecru.vercel.app (or https://outlly.com once the domain works).
   Without it the unsubscribe links in email have no host.
2. Email DNS, once outlly.com resolves (it currently does not exist in DNS, so register / point the domain first):
   - In Resend > Domains add mail.outlly.com and news.outlly.com. Resend shows the exact records for each
     (an MX and an SPF TXT on send.<sub>, and a DKIM TXT on resend._domainkey.<sub>). Copy them exactly.
   - DMARC, one TXT for the root: name _dmarc, value  v=DMARC1; p=none; rua=mailto:dmarc@outlly.com
     (start with p=none; move to p=quarantine after a few weeks of clean reports).
   - Then in Admin > Integrations: From = Outlly <hello@mail.outlly.com>, Marketing from = Outlly <hi@news.outlly.com>.
3. Google Search Console: add outlly.com, verify with the TXT it gives you, submit /sitemap.xml.

## Checks
tests/round-1026b-unsubscribe.test.ts (14 tests). Independent review: 4 findings, all fixed (one-click never redirects, per-link rate limit so Gmail's shared IPs are not throttled, weekly opt-out sticks for changed addresses, absolute links when APP_URL is unset). Full suite 535 pass, 0 fail. tsc clean.


---

# fix-1026e-delete-env (upload after fix-1026b-email, or straight after the live code: it doesn't depend on 1026b)

5 files. Nothing to delete, no database change (removeMode is a text column; "deleting" is just a new value).

## 1. Deleting a post from a platform can no longer leave it looking live
Before: Outlly deleted the post on X/Facebook/YouTube/etc. first and saved that afterwards. If the save failed,
the post was gone from the platform but still showed as live, and pressing Delete again could fail (X answers
"deleted=false" for a post that is already gone).
Now:
- Outlly writes "deleting" on the post BEFORE calling the platform.
- After the platform deletes it, the save is retried 3 times.
- If it still can't save, you see "It's deleted from X, but we couldn't save that here. Press it once more to
  finish", and the next press completes it (a "not found" / "deleted=false" answer then counts as done).
- If the platform refuses, the marker is put back exactly as it was (a private YouTube video stays private).

## 2. Every platform's keys can come from Vercel env as a fallback
Admin > Social platforms still wins. New optional env vars (fill only if you prefer env over the admin page):
FACEBOOK_CLIENT_ID (Meta App ID), FACEBOOK_CLIENT_SECRET, THREADS_CLIENT_ID, THREADS_CLIENT_SECRET,
LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, TIKTOK_CLIENT_ID (TikTok "Client key"), TIKTOK_CLIENT_SECRET.

## Checks
tests/round-1026e-delete-order.test.ts (5 tests). Full suite 540 pass, 0 fail. tsc clean.


---

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


---

# fix-1028-mobile-app

Upload AFTER fix-1027-queue-hardening. 15 files. No schema change.
Web visitors see no change: everything new is gated to `html[data-app]`, which only the Android app sets.

## Android app mode
- `lib/app-mode.ts`: head script marks `<html data-app="android">` before first paint when the page was opened by
  the app (`?source=twa`, or the `android-app://com.outlly.app` referrer) and remembers it in sessionStorage
  (per app tab, never shared with the person's normal Chrome tabs). `appNavKind` / `appTitle` for transitions and titles.
- `middleware.ts`: `?source=twa` survives the sign-in redirect; `/.well-known` is excluded from middleware so
  maintenance or waitlist mode can never redirect `assetlinks.json` (that would break app verification).
- `public/.well-known/assetlinks.json`: Digital Asset Links for com.outlly.app (upload key). Add the Play App Signing
  SHA-256 as a second fingerprint once the app is in Play Console.

## Apple HIG + Liquid Glass UI (phones, app only)
- `components/shell/AppChrome.tsx` (new): large-title nav bar that collapses into a glass inline title on scroll,
  Back button with parent name on deeper screens, bell + avatar; floating Liquid Glass tab bar (Home, Calendar,
  Inbox, Analytics) with a spring-animated selection pill and a separate lime Create button, shrinking while you
  scroll down; Account sheet (drag to dismiss) with grouped iOS lists and an Appearance segmented control;
  Create presented as a sheet with a grabber (pull down to close); light haptics on tabs, switches, segments.
- `app/mobile-app.css` (new): Liquid Glass material (blur + saturation, refracted rim, specular sheen), iOS push /
  pop / cross-fade / sheet transitions, UISwitch styling, press feedback, safe areas. Solid surfaces under
  reduced transparency or More contrast; no motion under reduced motion.
- `PageTransition`: inside the app, iOS transitions replace the web wave and stagger.
- `Nav.tsx`, `HomeHero.tsx`, `AuthCard.tsx`: class hooks only (`web-only`, `app-hide`, `app-invisible`).

## Google Play billing policy
- No plans, prices or upgrade buttons in the app (`APP_SELLS_PLANS = false`): billing/pricing links hidden,
  /billing redirects to Settings, the welcome subscribe popup never opens, and the plan-limit popup explains the
  limit without a buy button. The website is unchanged.

## Checks
579 pass (17 new in tests/round-1028-mobile-app.test.ts), tsc 0, next build ok.

## Note found while testing
Local dev.db was behind the schema (PostTarget.removedAt/removeMode, Payment.invoice, EmailOptOut table), which
crashed /inbox locally. If production hasn't had `prisma db push` since fix-1026c, the live Inbox will crash
the same way: run it.


---

# fix-1029-capacitor: website side of the native Android app (Outlly 1.1.0, Capacitor)

Upload AFTER fix-1028-mobile-app (order: 1026b → 1026e → 1027 → 1028 → 1029). Copy the files over the
repo at the same paths. 32 files, 18 of them new.

## After the deploy
1. **Production DB:** `prisma db push`. This adds the `PushDevice` table, and the push route fails without it.
2. Optional, for push: set `FCM_SERVICE_ACCOUNT` on Vercel (Firebase service-account JSON, raw or base64).
   If it is empty, push is off and everything else works.

## What changed
- **Native app detection.** The Capacitor app's user agent contains `OutllyApp/`. `lib/app-mode.ts` turns on
  app mode and adds `html[data-shell=native]`. TWA detection is unchanged.
- **`lib/client/native.ts`:** a bridge to `window.Capacitor` with no dependencies. On the web every call is a
  no-op. It provides `saveBlob` (files go to Downloads in the app), `openInBrowser` (Custom Tab) and `shellInfo`.
  Haptics use the native Haptics plugin in the app.
- **Browser sign-in handoff** (`lib/app-handoff.ts`, `app/api/app/{handoff,start,return,finish}`, `/app-auth`):
  - Inside the app, Google sign-in and platform connects redirect to `/app-auth?to=…`. The flow then runs in a
    Chrome Custom Tab and comes back through `outlly://auth?code=`.
  - The code is PKCE-bound: it only redeems with the verifier, which stays in the app.
  - Start links are signed, expire after 10 minutes, are single-use (a FeatureUse `app-start` slot) and only
    allow `/api/auth/google` and `/api/accounts/{p}/connect`, so there is no open redirect.
  - Codes expire after 5 minutes.
  - `middleware.appBounce` sends a Google error page or the waitlist reached during an app flow back to the app.
- **Push** (`lib/push/fcm.ts`, `lib/push/device.ts`, `app/api/app/push`, model `PushDevice`):
  - FCM HTTP v1 through a jose-signed service-account JWT.
  - Every new studio notice (`notify()`) is pushed to the user's phones, up to 10 devices.
  - Dead tokens are dropped. A tap only opens a path on this site.
  - Log out forgets this phone, and log out everywhere forgets all of them.
- **`/app-share`:** a video or text shared to Outlly from another app opens in Create.
- **`NativeBridge`** (studio layout):
  - Status bar icons follow dark/light mode.
  - The notification permission is asked once, 2.5 s after the studio opens, then the device registers.
  - The account sheet gets a "Notifications" row (app only) that opens Android's settings for Outlly.
- The .srt downloads (ClipCutter, CaptionBurner) and the recovery codes (TwoStepCard) use `saveBlob`.

## Verified
- `tsc --noEmit` reports 0 errors.
- `bun test`: 609 pass, 0 fail (30 new tests in `tests/round-1029-capacitor.test.ts`).
- `next build` passes.


---


---

# fix-1030-flutter-api: API support for the Flutter app (Outlly 2.0.0)

Upload after fix-1029-capacitor. 5 files, 2 of them new. There are no DB changes.

- **lib/native-client.ts (new).** The app sends `x-outlly-client: android/2.0.0+3` on every request.
- **lib/http.ts (CSRF).** A request with no Origin is now accepted when it carries that header.
  - Browsers can't add a custom header across sites without a CORS preflight, and this API never grants one.
  - A request that does carry an Origin is still checked as before, with or without the header.
  - Without the header, a request with no Origin is still refused. The website is unchanged.
- **lib/auth.ts.** Adds `renewSession()`: the app's session is re-issued once it is more than 3 days old.
  As long as the app is opened within 14 days, the person stays signed in. Web sessions are unchanged.
- **app/api/me/route.ts (new).** Returns the signed-in user, their team workspace and role, and feature flags.
  The app calls it on launch, and for the app it also renews the session.

The app keeps the normal session cookie in Android's encrypted storage. Every existing flow (login, 2-step,
email code, team switch, Google and connects through the PKCE handoff) works without further server changes.

Verified:
- tsc reports 0 errors.
- bun test: 619 pass, 0 fail (10 new).
- next build passes.
- End to end against a local server, as the app: login, then /api/me, then /api/posts (200), then handoff, then logout (401 after).
  A login with no Origin and no app header gets 403 CSRF.
