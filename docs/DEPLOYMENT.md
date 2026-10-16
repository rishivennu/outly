# Deploying Outlly, and where the load balancer fits

## What actually made the app feel slow
A load balancer spreads traffic across machines. It does not make one page load faster for one user. The lag came from:

1. **Dev mode.** `next dev` compiles each page on first visit (seconds). Use `bun run build && bun run start` (or `bun run cluster`) for real use.
2. **Signed URLs one at a time.** Each thumbnail cost a ~460 ms round trip to Supabase, in sequence. These are now coalesced into one batch request per render, de-duplicated and cached (`lib/storage/index.ts`).
3. **48 PNG icons through the image optimiser.** These have been replaced by CSS objects (`components/brand/Icon3D.tsx`), so there are no requests and no resizing.
4. **Expensive animation.** Blur-filter entrances and a JS scroll-animation library on the landing page have been replaced by compositor-only transforms (`components/marketing/Reveal.tsx`).

## Load balancing
App servers are stateless (JWT cookie sessions, media in Supabase Storage). The one stateful part is the **job queue**: without `REDIS_URL` it runs inside the web process, so two instances would both run the scheduler. So:

| Setup | Instances | Command |
|---|---|---|
| No Redis | 1 | `bun run start` |
| Redis set | N web + 1 worker | `bun run cluster` + `bun run worker` |
| Production | N web behind nginx or the platform balancer + 1 worker | `deploy/nginx.conf` |

`bun run cluster` starts `CLUSTER_SIZE` instances (default min(4, cores/2)) on 3041+ with the built-in balancer on 3040 (`scripts/lb.mjs`). The balancer routes to the instance with the fewest active connections, health-checks `/api/health` every 5 s, fails a GET or HEAD over to another instance and never replays a POST. Live status is at `/__lb` (localhost only). Without `REDIS_URL` it refuses to scale past one instance.

High-traffic guards (1013b):
- **Overload shedding.** Each instance takes at most `LB_MAX_ACTIVE` requests at once (default 256). When every instance is full the balancer answers `503` with `Retry-After: 2` straight away, so a spike gets a fast "try again" instead of piling up until everything times out.
- **Stuck instance timeout.** An instance that accepts a request but sends nothing within `LB_TIMEOUT_MS` (default 60 s) gets a `504` for that request; when the visitor disconnects, the upstream request is cancelled too.
- **Proxy hygiene.** Hop-by-hop headers are stripped both ways and `X-Forwarded-Proto` / `X-Forwarded-Host` from a TLS terminator in front are kept, so OAuth redirects and secure cookies see `https`.
- **Graceful restart.** On SIGTERM the balancer stops accepting, lets in-flight requests finish for up to 10 s, then closes.

`deploy/nginx.conf` does the same in nginx and adds a disk cache for `/_next/static` (hashed files, cached a year), per-IP limits on `/api/` (20 r/s, burst 40, answers 429), a 3 s connect timeout so a dead instance is skipped quickly, and at most 2 upstream tries for GET/HEAD.

## On Vercel
Vercel already load-balances: each request is routed by its edge network to auto-scaled serverless instances, so there is nothing to install there and `scripts/lb.mjs` / nginx are only for self-hosting (a VPS, Docker or bare metal). What matters on Vercel is that the database can take the connections: use the Supabase **pooler** URL (port 6543, `?pgbouncer=true&connection_limit=1`) as `DATABASE_URL`, and keep `DIRECT_URL` for migrations.

Caveats when scaling out: the rate limiter (`lib/rate-limit.ts`) and the signed-URL cache are per process, so limits are per instance. Move the limiter to Redis before relying on it under abuse. SQLite is single-machine only, so switch to Supabase Postgres (docs/INTEGRATION_STATUS.md) before running instances on more than one host.

## Going to production (checklist)

1. **Push the schema.** `bun scripts/prisma-provider.mjs && npx prisma db push --skip-generate && npx prisma generate`, against the `DIRECT_URL` (port 5432) database. The 10-16 round added `User.tokenVersion` and the `AiUsage` table, so an older database will fail on sign-in and on every AI call until this runs.
2. **Set the environment.** Beyond the usual `DATABASE_URL` / `DIRECT_URL` / `AUTH_SECRET` / `TOKEN_ENCRYPTION_KEY` / `APP_URL`:

| Variable | What it does | If unset |
|---|---|---|
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Shared rate limits across serverless instances (`lib/rate-limit.ts`) | Limits are per instance, so the real ceiling is limit x instances |
| `AI_DAILY_LIMIT` | Model calls one creator may make per UTC day (default 60) | 60. `0` means no cap |
| `AI_SUPPORT_DAILY_LIMIT` | The same for the help chat (default 40) | 40. `0` means no cap |
| `CRON_SECRET` | Bearer token for `/api/cron/*` and for the diagnostics in `/api/health` | The cron routes answer `503` and nothing is ever published on a schedule |
| `GEMINI_API_KEY` | Hooks, platform copy, reply suggestions, captions, the deep review | Those features fall back to the offline studio copy or say AI is not set up |
| Resend: set **Integrations > Email** to `resend` with its API key in the admin console (`provider`, `from`, `replyTo`) | Real email. Invoices, nudges, security notices | The `mock` provider writes to `EmailLog` only, so nothing reaches anyone |

3. **Payments.** Pick a provider and add its keys in the admin console. With `mock` (or a provider missing keys) checkout is simulated, which in production logs `[payments] WARNING: the simulated payment gateway is live in production` once and shows `paymentsMock: true` in `/api/health`. Mock checkout itself is refused in production unless `ALLOW_MOCK_PAYMENTS=true` (staging only).

## Storage: Cloudflare R2 (large uploads)

Supabase Free caps each object at 50 MB. R2 has no practical cap, 10 GB free storage and free egress. Browsers upload straight to R2 (Vercel never sees the bytes):

- up to 10 MB: one presigned PUT, its Content-Length pinned in the signature so the size cannot be swapped
- above that: S3 multipart, 10 MB parts, 4 in parallel, each part URL pinned to its exact size; retries per part and resumes after a reload
- `/api/media/direct/complete` lists the parts on R2 and refuses (409 `PARTS_MISSING`) unless every part is there and the sizes add up, then checks the file's magic bytes

### Setup

1. Cloudflare dashboard, **R2 Object Storage**, **Create bucket** `outlly-media` (private, location Automatic).
2. Bucket **Settings, CORS policy**:
   ```json
   [{"AllowedOrigins":["https://outly-ecru.vercel.app","http://localhost:3040"],"AllowedMethods":["PUT","GET","HEAD"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]
   ```
3. R2 overview, **Manage R2 API Tokens, Create API token**: permission **Object Read & Write**, scoped to `outlly-media`. Copy the Access Key ID and Secret Access Key (shown once) and the Account ID.
4. Environment:

| Variable | Value |
|---|---|
| `STORAGE_DRIVER` | `r2` |
| `R2_ACCOUNT_ID` | account id |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | token keys |
| `R2_BUCKET` | `outlly-media` (default) |
| `R2_ENDPOINT` | optional, e.g. `https://<id>.eu.r2.cloudflarestorage.com` for an EU bucket |
| `UPLOAD_PART_MB` | optional, part size 5 to 100 (default 10) |
| `UPLOAD_PIN_LENGTH` | optional, `false` only if R2 ever rejects signed Content-Length |
| `MAX_UPLOAD_MB` / `NEXT_PUBLIC_MAX_UPLOAD_MB` | e.g. `500` (X caps video at 512 MB) |

### Moving existing files from Supabase

Keep the Supabase env vars set (plus `CRON_SECRET`), then call the copy job until `next` is null:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://outly-ecru.vercel.app/api/cron/storage-copy
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "https://outly-ecru.vercel.app/api/cron/storage-copy?cursor=<next>"
```

It copies each media file and thumbnail, skips ones already on R2 with the same size, and returns `{copied, skipped, missing, failed, next}`. It works whatever `STORAGE_DRIVER` is, so: add the R2 keys, run it once, switch `STORAGE_DRIVER=r2`, redeploy, run it once more to catch files uploaded in between. Local tests use a fake S3 server (`tests/helpers/fake-s3.ts`) that verifies SigV4 independently.

## Cron: what actually sends a scheduled post

Self-hosted (`bun run start` / `bun run worker`) has an in-process sweeper every 15 s, so there is nothing to set up. Serverless has no always-on process, so a scheduled post only goes out when something calls the sweeper:

| Route | Schedule | Does |
|---|---|---|
| `/api/cron/sweep` | every minute, from an external pinger | Picks up posts whose time has come and re-queues platform uploads stuck in `queued` for over 2 minutes. Idempotent, safe to call as often as you like |
| `/api/cron/retention` | `30 6 * * *` | Expiring-token warnings, reconnect reminders, the Friday goal nudge, and the data prune (email logs, admin events and behaviour analyses over 90 days, metric samples over 180, sign-in codes over a day) |
| `/api/cron/weekly-report` | `30 3 * * 1` | Monday summary email |

All three need `Authorization: Bearer $CRON_SECRET`; Vercel Cron sends it automatically once `CRON_SECRET` is set.

**The sweep is not in `vercel.json`, on purpose.** Vercel Hobby only allows daily crons, and a sub-daily entry makes a Hobby deploy *fail*, so the per-minute sweep is driven from outside the app. Point a pinger at it every minute, for example [cron-job.org](https://cron-job.org):

```
URL:    https://your-domain/api/cron/sweep
Method: GET          (POST works too, so any pinger will do)
Every:  1 minute
Header: Authorization: Bearer <CRON_SECRET>
```

Only on **Vercel Pro** (which allows minute crons) you may add it to `vercel.json` instead and drop the pinger:

```json
{ "path": "/api/cron/sweep", "schedule": "* * * * *" }
```

Either way something must call it every minute: with nothing calling it, scheduled posts never go out. Maintenance mode does not stop it, because members keep posting while maintenance is on.

## Sessions: signing out everywhere

Session cookies carry the user's `tokenVersion` as a `v` claim. `POST /api/auth/logout-all` bumps that integer (`revokeAllSessions`), which instantly invalidates every cookie that person has anywhere, including the one that made the request. The same happens when their credential changes, and the device doing it is signed straight back in, so only the other devices are kicked out. There is no session table to clear.

## Verifying a deploy

```
curl -s https://your-domain/api/health -H "Authorization: Bearer $CRON_SECRET"
```

```json
{ "ok": true, "dbMs": 24, "queue": "inline", "overdue": 0, "stuck": 0, "paymentsMock": false }
```

- `ok` / `dbMs`: this instance can reach the database. Public; everything below needs the bearer (or an admin cookie).
- `queue`: `redis` when `REDIS_URL` is set and a worker is running, `inline` when jobs run inside the web process.
- `overdue`: scheduled posts whose time passed more than 5 minutes ago. Anything above 0 means the sweeper is not being called: check the cron above.
- `stuck`: platform uploads queued more than 5 minutes ago and never picked up. Above 0 with `queue: redis` means no worker; with `inline` it means the instance was recycled mid-job. `/api/cron/sweep` clears both.
- `paymentsMock`: `true` means no real money is being taken.

Then sign in, publish one post, and check `/api/cron/sweep` returns `{"ok":true}` with the secret and `401` without it.
