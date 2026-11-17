# Outlly subdomains (round 1185)

One deployment, one database, one sign-in. Every subdomain below is an entry point handled in `middleware.ts` by the
pure table in `lib/hosts.ts` (tests: `tests/round-1185-hosts.test.ts`). The canonical origin stays
**https://www.outlly.com**: OAuth redirect URIs, Meta app review, the Android TWA assetlinks, the service worker, web
push, IndexedDB device drafts and Google One Tap origins all depend on it.

- Redirect targets use APP_URL when it is an `https://…outlly.com` URL, else `https://www.outlly.com`. They are never
  built from the request Host header; the Host is only looked up in the fixed table.
- Redirects are **307** (not cached for good while we are still deciding). The query string is kept.
- Session cookies stay **host-only**. `Domain=.outlly.com` would send the studio session to `email.outlly.com`
  (GoDaddy webmail) and the Resend tracking hosts. So a studio session on www does not carry to other subdomains, and
  admin.outlly.com is its own origin with its own `outly_admin` cookie.
- Unknown hosts (localhost, `*.vercel.app` previews, apex, www) behave as before.

## Table

| Host | Mode | Target | Notes |
|---|---|---|---|
| app.outlly.com | redirect | /home | Studio paths and /login, /signup kept (app.outlly.com/create -> www/create) |
| dashboard.outlly.com | redirect | /home | Same as app |
| studio.outlly.com | redirect | /create | /create/** kept |
| publish.outlly.com | redirect | /content | /content, /approvals kept. There is no separate queue page: the content library holds queued, scheduled and published posts |
| scheduler.outlly.com | redirect | /calendar | |
| analytics.outlly.com | redirect | /analytics | /analytics/** kept |
| integrations.outlly.com | redirect | /accounts | Connected social platforms |
| auth.outlly.com | redirect | /login | /signup kept |
| help.outlly.com | redirect | /help | |
| docs.outlly.com | redirect | /help | |
| status.outlly.com | redirect | /status | |
| blog.outlly.com | redirect | /blog | /slug -> /blog/slug, /blog/** kept |
| pricing.outlly.com | redirect | /#pricing | Query goes before the hash |
| admin.outlly.com | serve | /admin | `/` -> admin.outlly.com/admin; /admin/** served through the normal pipeline (CSP, admin cookie check); /api/**, /_next/**, files served in place (middleware matcher skips them); any other page -> 307 to www, same path |
| api.outlly.com | serve | /api | /x rewritten to /api/x, /api/x as is; `/` -> `{"service":"outlly-api","docs":"https://www.outlly.com/help"}`; X-Robots-Tag noindex; no CORS change |
| webhooks.outlly.com | serve | webhook routes | Rewrites (never redirects): /meta, /meta/deletion, /resend -> /api/webhooks/…; /razorpay, /stripe, /paypal, /youpi -> /api/billing/webhooks/…; the full /api/… paths also work; anything else 404; noindex |
| media.outlly.com, cdn.outlly.com | serve | static only | /_next/static/**, files under public/ (audio, brand, brands, samples, root files) by extension; everything else 404, including /api/files (private media needs the www session) and /.well-known; noindex |
| outlly.com, www.outlly.com | unchanged | | |

### Admin canonical switch (optional)

Set env `ADMIN_HOST=admin.outlly.com` to send www (and apex) `/admin/**` to `https://admin.outlly.com/admin/**` (307).
Unset = no redirect, so nobody is locked out before the domain is live. Any other value is ignored. After switching,
admins sign in again on admin.outlly.com (the cookie is host-only).

## What the owner must do (per host)

1. Vercel: Project > Settings > Domains > Add `<host>` (e.g. `app.outlly.com`), attach to the production branch.
   Do **not** set a Vercel-level redirect for these hosts: the middleware does it.
2. DNS (GoDaddy): `CNAME <name> -> 2ab853432d6ea6e1.vercel-dns-017.com`, DNS only (no proxy). Leave `email`,
   `send`, `rsend` and the mail records alone.
3. Wait for Vercel to issue the certificate, then check: `curl -sI https://<host>/` shows the 307 and Location above
   (api.outlly.com shows JSON, cdn.outlly.com/ shows 404).
4. webhooks.outlly.com: only move a provider (Razorpay, Stripe, PayPal, Meta, Resend) to the short URL after the domain
   is live; signatures are checked by the route as before. The existing www URLs keep working.
5. admin.outlly.com: once it answers, optionally set `ADMIN_HOST=admin.outlly.com` in Vercel env and redeploy.

The middleware matcher has a second entry (host `api|webhooks|media|cdn`) so those hosts run the middleware on every
path, /api and files included. `lib/hosts.ts` ALL_PATH_HOSTS must stay in step with it (a test checks).
