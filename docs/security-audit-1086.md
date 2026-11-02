# Outlly security audit and fixes (round 1086)

Date: 2026-11-02. Scope: the Outlly codebase (github.com/rishivennu/outly) as deployed at https://www.outlly.com. Method: white-box source review of every API route, auth, payment, OAuth, upload and deployment path, plus dependency audit (`bun audit`). No traffic was sent to production beyond normal page loads; no destructive, DoS or brute-force tests were run.

## Summary

| ID | Severity | Area | Status |
|----|----------|------|--------|
| F-1 | Medium | Login CSRF / account attach via app start link | FIXED, tests added |
| F-2 | Low | 2FA wrong-code lockout kept in memory per serverless instance | FIXED, tests added |
| F-3 | Low | App finish code replayable within its 5-minute lifetime | FIXED, tests added |
| D-1 | High (dependency) | next 14.2.35 has published advisories, fixes only on 15.5.x | NOT FIXED, needs planned upgrade |
| D-2 | Low (dependency) | zod < 4.6.6 memory DoS on crafted input; postcss (build time only) | NOT FIXED, bundle with D-1 |
| H-1 | Info | `x-outlly-client` CSRF skip relies on no CORS ever being added to /api | Hardening note |
| H-2 | Info | `ALLOW_MOCK_PAYMENTS` must never be set in production | Deployment rule |

No Critical findings. The code base is in good shape: one `route()` wrapper enforces Origin CSRF, auth and rate limits; zod strips unknown fields before every write; ownership helpers scope every lookup; every webhook verifies its signature.

## F-1 Medium: login CSRF / account attach via the app start link

**Where:** `app/api/app/handoff`, `app/api/app/start/route.ts`, `app/api/accounts/[platform]/callback/route.ts`.

**Root cause:** the Android app opens the browser through `/api/app/start?t=<token>`, which signs the browser in as the token's user so the OAuth connect can finish. Any signed-in user can mint that token for themselves with `POST /api/app/handoff`. The session it created was a normal, full, remembered session, and the web connect callback accepted it like any other.

**Repro (before fix):**
1. Attacker signs in, calls `POST /api/app/handoff`, gets `https://www.outlly.com/api/app/start?t=...` carrying the attacker's uid.
2. Attacker sends the link to a victim ("see my content calendar").
3. Victim opens it: the browser is now signed in as the attacker and lands on the Instagram connect step.
4. If the victim approves Meta's dialog, the victim's Instagram account and token are saved into the attacker's workspace. The attacker can then read the victim's DMs/insights and post as them.

**Fix:**
- `lib/auth.ts`: `createSession(uid, { handoff: true })` makes a hand-off session: 15-minute life, never remembered, carries claim `ho:1`. New `isHandoffSession()`. `renewSession` refuses to extend it; `reissueSession` keeps the flag.
- `app/api/app/start/route.ts`: uses the hand-off session.
- Callback: a hand-off session may only finish a connect inside the real app flow (returnTo is the app return path AND a valid `ol_app_ch` challenge cookie set by the app's start). Otherwise it fails with `reason=state`.
- In the app flow the connected account is no longer saved directly. It is encrypted and held (`holdConnect`, `Setting` row `app-hold:<uuid>`, 15 minutes). The hold id travels inside the signed app code; `/api/app/finish` saves it only when the app redeems the code with the matching PKCE-style challenge (`takeHeld`, one use, checks uid + challenge + TTL). A victim who opens an attacker's link has no app holding the challenge, so nothing is ever saved.
- Normal web connects (regular session) are unchanged.

## F-2 Low: 2FA lockout was per instance

**Where:** `lib/otp/two-factor.ts`.

**Root cause:** the 6-wrong-codes-per-15-minutes counter lived in process memory. On Vercel each cold instance starts at zero and Upstash is not configured in production, so a guesser spread over instances got far more than 6 tries.

**Fix:** `guard()`/`wrong()` are now async and also record failures in the database (`FeatureUse`, feature `2fa-fail`, 15-minute window, old rows swept). The in-memory counter stays as a fast first check. All call sites updated (`await guard`, `throw await wrong`).

## F-3 Low: app code replay

**Where:** `lib/app-handoff.ts` (`signCode`/`redeemCode`).

**Root cause:** the code returned to the app was signed but not single use, so a leaked code (logs, shared screen recording) could be redeemed again within 5 minutes.

**Fix:** codes carry a `jti`; `redeemCode` claims it once with `claimOnce(uid, "app-code", jti)` (unique row), so a second redeem fails. `claimStart` now uses the same helper.

## Dependencies (D-1, D-2), NOT FIXED

`bun audit`: 31 advisories (3 critical, 12 high, 14 moderate, 2 low), almost all through `next@14.2.35`. Fixes are only published on the 15.5.x line: 15.5.28+ covers all of them, including the SVG image RCE.

Exposure today, from the code: the Windows-only RCE does not apply (Vercel runs Linux). The image-optimizer issues need `next/image` (used in 2 files; `sharp` not installed, Vercel's optimizer handles it), so exposure is low. The CSP-nonce cache-poisoning XSS is blocked because middleware always overwrites the inbound `content-security-policy` header. Still, running a major version with known advisories is the biggest remaining risk.

**Recommendation:** upgrade to Next 15.5.28+ (and zod to 4.6.6+ or the patched 3.x if available) as its own round: async `cookies()`/`headers()`, `params` as Promise, fetch caching defaults change. Run the full suite plus a manual smoke of sign-in, connect, post, pay.

## Checked and found OK

- CSRF: Origin/Referer check on every state-changing route; `x-outlly-client` skip is safe because no `/api` route sends CORS headers (only `/brand/email/fonts`).
- Auth: session HMAC, password hashing, password-change fingerprint, admin uses a separate secret, prod admin fallback blocked.
- Authorization / IDOR: posts, media, invoices, receipts, team scope (`ownedPost` -> `assertPostScope`; the subagent's IDOR flag was a false positive).
- Injection: no raw SQL; `execFile` with argv array; email templates escape; no `dangerouslySetInnerHTML` with user data.
- Files: `/api/files` HMAC-signed keys, key regex, no `..`, sandbox CSP on served files.
- Payments: server-side prices, idempotent orders; Stripe (HMAC, 5-minute window), Razorpay (HMAC), PayPal (verify API), YOUPI (HMAC + gateway re-fetch).
- OAuth: encrypted state cookie, 10 minutes, constant-time compare, one use; redirects limited by `sameSitePath`.
- Meta webhooks: signature verified against all configured secrets.
- Cron: constant-time Bearer `CRON_SECRET`, 503 when unset.
- Headers: HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, nonce CSP, `poweredByHeader: false`.
- Secrets: none hard-coded (pattern hits are key-prefix checks and a dummy test key).

## Residual risks after the fix

- **Hand-off session elsewhere in the web app (Low).** For up to 15 minutes, a browser opened from someone else's start link is signed in as that person everywhere except the connect callback. A victim could still upload media or start a checkout inside the sender's workspace without noticing (the usual leftover risk of login CSRF). The account-takeover path (saving the victim's Instagram) is closed. Optional hardening: let a hand-off session reach only the connect, callback and app-return routes, and show a "signed in as X" banner.
- **Attacker-chosen challenge (by design, safe).** The challenge in a start link comes from whoever minted it, so the victim's browser does get a valid `ol_app_ch` cookie and the connect is held. The one-use code that releases it is only sent to the `outlly://` deep link on the victim's own device. The attacker never sees it, and the victim's app (if installed) has a different verifier, so finish returns 400 and the hold expires unsaved.
- **2FA DB counter fails open on DB errors.** The in-memory limit still applies, and checking the code itself needs the database, so a DB outage blocks sign-in anyway.
- **Independent review (separate reviewer agent, read-only).** Verdict: the F-1 attack no longer succeeds; no race in `takeHeld` (conditional delete, one winner); no type or logic bugs in the session changes. Low notes: (a) start links and codes without a uid are not one-use, but they sign nobody in and can't release a hold; (b) `/api/app/return` mints a new code on each load for the holder of the app cookie, and each code still needs the app's verifier; (c) expired holds were swept only on the next hold, now FIXED by also sweeping in `takeHeld`. Inherent to the design: a malicious app on the victim's own phone that registers `outlly://` could catch the code.

## Regression tests

`tests/round-1086-security.test.ts` (15 tests): hand-off session life/claims/no renew; hold store encrypt/one use/uid and challenge binding/expiry; the full F-1 attack (victim opens attacker link, callback refuses, nothing saved); one-use app codes; 2FA lockout survives a cleared memory counter (DB count).

## Retest results

- Baseline before changes: 1127 pass, 0 fail (93 files).
- After changes: 1142 pass, 0 fail (94 files, 7301 expect calls). `tsc --noEmit` exit 0.
- `tests/round-1029-capacitor.test.ts` had one test signing an app code for a made-up uid. One-use codes are claimed in `FeatureUse`, which has a foreign key to `User`, so that test now uses a real user, checks the new return shape (`ch`, `hold`) and asserts a second redeem is refused. Production codes always carry a real uid.
- After the reviewer follow-up (hold sweep in `takeHeld`): 1142 pass, 0 fail, `tsc` exit 0. One earlier full run showed 3 timing failures in `round-1053-deletion.test.ts` (account-deletion cleanup, unrelated code); that file passed 3/3 alone and the next full run was green. Worth de-flaking separately.
- The `prisma:error Unique constraint failed` lines in test output are expected: they are the replay attempts being refused.

## NOT TESTED

- Live black-box testing against www.outlly.com (rules of engagement: read-only, no attack traffic).
- Production environment variables and Vercel project settings (not visible from code). Confirm `ALLOW_MOCK_PAYMENTS` is unset and `CRON_SECRET`, `SESSION_SECRET`, admin secret are long and random.
- Supabase/Postgres row-level security and network exposure of the live database.
- Rate limits in production (Upstash not configured, so limits are per instance).
- Live Meta and Google OAuth flows end to end after this change (needs a real device run of the Android app connect).
- The Next 15.5.x upgrade.
