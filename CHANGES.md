# fix-1018-security-upi (security audit fixes + privacy notice + YOUPI UPI gateway)

Upload every file in this folder to the repo root, keeping the paths. 38 files (plus this note).
Cumulative on top of fix-1017-analytics-subs: upload fix-1016-all, then fix-1016l-ux, then fix-1017-analytics-subs, then this folder. Where two bundles have the same file, the newer folder wins.
Do NOT upload vercel.json, tsconfig.json, .env, prisma/schema.prisma or any .db file. DO upload prisma/schema.template.prisma (it replaces the one from fix-1016l-ux and includes its changes).

.gitignore: if the GitHub repo already has one, merge these lines into it instead of replacing it. If it has none, upload this one. Then check the repo on GitHub for a committed .env file. If one was ever committed, rotate every key in it (AUTH_SECRET, TOKEN_ENCRYPTION_KEY, CRON_SECRET, GEMINI_API_KEY, database password), because deleting the file does not remove it from history.

## Before it goes live
- One database change: invoices can now exist without a user or payment, plus 5 new empty columns (provider, providerRef, taxPercent, issuer, detachedAt). The Vercel build pushes it by itself (scripts/db-sync.mjs). Nothing is dropped and Prisma asks for no data-loss flag. If you push by hand instead: `npx prisma db push`.
- Still pending from earlier bundles: `npx prisma db push` (PostTarget.firstComment*, Plan.yearlyMinor).
- YOUPI is off until you set it up (see section 3). Nothing changes for Stripe, Razorpay or PayPal.

## 1. Security audit fixes
- No .gitignore existed. The local .env (all secret keys) and storage/ (users' uploaded videos) would be pushed with the folder. New .gitignore covers .env, .env.*, .env*.local (keeps .env.example), storage uploads, build output, local DBs and logs.
- SSRF (server tricked into calling private addresses): the admin-settable FunASR worker URL and YOUPI gateway URL could point at localhost, 10.x / 192.168.x, or the cloud metadata address 169.254.169.254. Now refused in production, on save (400) and again before every call, including names that resolve to a private IP, IPv6 forms, and IPv4 hidden inside IPv6. Redirects are not followed. FUNASR_URL set by you on the server may still be private.
  lib/net/public-host.ts, lib/net/assert-public.ts, lib/ai/transcribe.ts, app/api/admin/engines/route.ts, lib/billing/youpi.ts, lib/billing/providers/index.ts
- Cron routes compare CRON_SECRET in constant time (no timing leak). app/api/cron/{sweep,retention,weekly-report,storage-copy}/route.ts
- HSTS header in production: browsers use https only for 2 years. next.config.mjs. Add "; preload" only once every subdomain of a custom domain serves https.
- Checked and clean: no secrets in client bundles (only public NEXT_PUBLIC values), API routes all check sign-in or a secret, other users' records can't be read by id, tokens encrypted (AES-256-GCM) and stripped from responses and exports, webhook signatures verified, storage links signed and expiring, no analytics or ad trackers, demo user is never seeded in production.
- Rate limits: keys sent to Upstash Redis (they hold IP addresses and emails) are now an HMAC, never the raw value, as /privacy says. lib/rate-limit.ts
- Review round: host names with extra trailing dots (localhost..) and the Teredo / IPv4-translated IPv6 ranges (2001:0::/32, ::ffff:0:0/96) are refused too. Known leftover: a name could in theory resolve to a public IP at the check and a private one a moment later (DNS rebinding); only an admin can set these URLs, so the risk is small.
- Not changed: CSP is still report-only. To enforce it, rename the header Content-Security-Policy-Report-Only to Content-Security-Policy in next.config.mjs after a week with no console reports.

## 2. Privacy notice ("How Outlly handles your data")
- Shown once per person on the first studio visit, after the cookie choice and before the tour and welcome offer (they now wait for it). Six short points: what we keep, who else gets it, how it's protected, how long we keep it, what we never do, your controls. Links to /privacy.
- Reopen any time: Settings > Your data > "How we handle your data".
- To show it to everyone again after a policy change, bump PRIVACY_VERSION in components/shared/PrivacyNotice.tsx.
- Radix dialog: focus trap, Esc, focus goes back to the button that opened it. axe 0 at 1280 light, 1280 dark and 390 dark. Buttons 44px+, text 13px+.
- If the notice is closed in one tab, it doesn't come back in that session; if it can't mount, the tour and welcome offer still start.
- On phones the card is taller than the screen, so it now starts at the top and scrolls (before, its top 100px was cut off).
- /privacy updated (dated 18 October 2026): self-serve Delete account and Download my data, YOUPI as a processor, FunASR, clip highlights, real retention periods, and Cloudflare R2 and Upstash listed as processors.
  components/shared/PrivacyNotice.tsx, app/(studio)/layout.tsx, components/onboarding/{SetupChecklist,WelcomeSubscribe}.tsx, components/settings/YourDataCard.tsx, app/(marketing)/privacy/page.tsx
- Invoices are kept for tax law after an account is deleted (see section 4). /privacy, the popup and the Delete account card all say so.

## 3. YOUPI UPI gateway (github.com/gxurav1710/YouPI-PG)
- New payment option "YOUPI (UPI)". You host the gateway yourself; it confirms payments by reading your bank's SMS and email alerts.
- Setup: host YouPI-PG on https. In Admin > Integrations choose YOUPI, enter the gateway URL, merchant id and webhook secret, pick "1 bank alert" or "SMS and email both", then copy the webhook URL shown (/api/billing/webhooks/youpi) into the YOUPI admin panel. Press Test, then do one real Rs 1 payment before going live.
- Safety: the plan is granted only when OUR server asks the gateway and it reports our order id, the exact amount in paise, INR, and enough alerts. Webhooks must carry a valid HMAC signature and are only a hint; replays do nothing. The buyer's return URL grants nothing on its own. A short payment is flagged for you to check, never granted. No name, email or phone is sent to the gateway.
- Limits: INR only. No refund API: refunds are refused in Admin with a message to refund manually by UPI. The YouPI-PG repo has no licence file (the README mentions commercial licensing), so no code was copied; this integrates only with its API. Check the licence with the author before using it commercially.
  lib/billing/youpi.ts, app/api/billing/webhooks/youpi/route.ts, lib/settings.ts, lib/billing/{currency,service}.ts, lib/billing/providers/index.ts, app/(studio)/billing/page.tsx, app/api/admin/integrations/route.ts, app/api/admin/integrations/test/route.ts, app/admin/(panel)/integrations/page.tsx, components/admin/IntegrationsForm.tsx

## 4. Invoices kept after account deletion (tax law)
- Before: deleting an account also deleted its invoices, while /privacy promised to keep them as tax law requires. Indian GST law (CGST Act s.36) needs them for 72 months after the year's annual return is due.
- Now: deleting an account detaches its invoices instead. They are no longer linked to any user or payment (a new account with the same email can't see them), detachedAt is set, and everything else is deleted as before. The retention cron deletes a detached invoice 8 years after its date, which covers the longest case. Invoices of live accounts are never touched.
- Each new invoice stores a copy of what it prints (gateway and reference, tax rate, your business name, address and GSTIN), so a PDF downloaded years later shows the same numbers even if you change the settings. Invoices issued earlier keep reading today's settings while the account is live; at delete time they get the gateway, tax rate and business details frozen in, so the kept copy stops changing.
- Clear sample data now also removes sample invoices.
- This browser's offline copies of the Billing page and invoice PDFs (service worker cache) and the saved invoice list are now cleared on Sign out, Sign out everywhere and Delete account, so the next person on a shared device can't open them offline. lib/client/forget-billing.ts, components/settings/SettingsView.tsx, components/settings/YourDataCard.tsx
- An admin can still download any kept invoice at /api/billing/invoices/<number>. There is no list of kept invoices in Admin yet.
- Check the 8 years with your CA.
  prisma/schema.template.prisma, lib/account.ts, lib/billing/invoice.ts, lib/retention/prune.ts, lib/admin/sample.ts, app/(studio)/billing/page.tsx, components/settings/YourDataCard.tsx, components/shared/PrivacyNotice.tsx, app/(marketing)/privacy/page.tsx

## Tests
tests/round-1018-youpi.test.ts (8), tests/round-1018-security.test.ts (11), tests/round-1018-invoices.test.ts (4). Full suite 479 pass, tsc 0, production build passes.
