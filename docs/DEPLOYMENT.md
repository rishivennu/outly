# Deploying Outly, and where the load balancer fits

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

`bun run cluster` starts `CLUSTER_SIZE` instances (default min(4, cores/2)) on 3041+ with the built-in balancer on 3040 (`scripts/lb.mjs`). The balancer routes to the instance with the fewest active connections, health-checks `/api/health` every 5 s, fails a GET or HEAD over to another instance and never replays a POST. Live status is at `/__lb`. Without `REDIS_URL` it refuses to scale past one instance.

Caveats when scaling out: the rate limiter (`lib/rate-limit.ts`) and the signed-URL cache are per process, so limits are per instance. Move the limiter to Redis before relying on it under abuse. SQLite is single-machine only, so switch to Supabase Postgres (docs/INTEGRATION_STATUS.md) before running instances on more than one host.
