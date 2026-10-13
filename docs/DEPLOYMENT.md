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
