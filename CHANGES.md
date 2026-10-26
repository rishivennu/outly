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
