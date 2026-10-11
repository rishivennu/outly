# Outly

One video. Every platform. Zero chaos.

Upload a video once, shape it for Instagram Reels, YouTube Shorts and X, then publish or schedule it everywhere.

Next.js 14 (App Router) · TypeScript · Tailwind · Radix/shadcn primitives · Framer Motion · Prisma · Supabase (Auth, Storage, Postgres) · Redis + BullMQ · FFmpeg (optional).

Honest status of every integration, what is verified and what is blocked: **[docs/INTEGRATION_STATUS.md](docs/INTEGRATION_STATUS.md)**.

## Run it locally (no accounts needed)

```bash
bun install
cp .env.example .env            # then set AUTH_SECRET and TOKEN_ENCRYPTION_KEY (openssl rand -base64 32)
# offline: DATABASE_PROVIDER=sqlite, DATABASE_URL="file:./dev.db", DIRECT_URL="file:./dev.db"
bun run scripts/prisma-provider.mjs
npx prisma generate && npx prisma db push
bun run db:seed                 # demo creator: creator@studio.dev / studio123
bun run dev                     # http://localhost:3040  (landing at /, studio at /home)
bun test                        # 57 tests: publishing state machine, auth, failure mapping, mock/real separation
```

For fully offline dev also set `AUTH_PROVIDER=local` and `STORAGE_DRIVER=local`.

With `REDIS_URL` empty, jobs and the scheduler run inside the Next.js process. Publishing is mocked (`MOCK_SOCIAL_PUBLISHING=true`), so nothing reaches a real platform.

## Use Supabase

1. Create a project. Under **Project Settings → Database → Connection string**, copy:
   - **Transaction pooler** (port 6543) into `DATABASE_URL`, adding `?pgbouncer=true&connection_limit=1`
   - **Session / direct** (port 5432) into `DIRECT_URL` (used by `prisma db push` and migrations)
2. Set `DATABASE_PROVIDER=postgresql`, then:
   ```bash
   bun run scripts/prisma-provider.mjs && npx prisma generate && npx prisma db push && bun run db:seed
   ```
3. Lock the Data API: run `supabase/migrations/0001_rls.sql` in the SQL editor (RLS on, no policies; the server uses Prisma as the owner role).
4. Storage: create a **private** bucket `media` (Free plan: 50 MB per object). Set `STORAGE_DRIVER=supabase`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_BUCKET=media`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   Browsers upload straight to the bucket with one-time signed tokens (TUS resumable above 6 MB, with real progress, ETA, cancel and resume). Files are only ever read through short-lived signed URLs.
5. Auth: `AUTH_PROVIDER=supabase`. Passwords live in Supabase Auth; existing local accounts migrate on their next sign-in. Outly still issues its own HttpOnly session cookie.

## Workers (production)

Set `REDIS_URL`, then run the web app and the worker separately:

```bash
bun run build && bun run start
bun run worker                  # BullMQ: media processing, publish-target, scheduled sweeper
```

Each platform target is its own job with retries and exponential backoff. A post is only marked **Published** after the platform API confirms it.

## Practice mode

Accounts connected while mocking is on are **practice accounts** (`mock-` ids). They rehearse the whole flow, are labelled Practice, never get a link, and are never sent to a real API. Real accounts never fall back to the mock.

**Settings → Practice mode** sets how the mock platforms behave: *Like real life* (occasional rate limit, auto-retried), *Everything works*, *Instagram needs you* (expired token, reconnect flow), *YouTube is wobbly* (fails, then retries succeed) and *X says no* (permanent rejection).

## Architecture

```
app/(auth)        login, signup
app/(studio)      home, create, content, calendar, analytics, accounts, settings
app/api           route handlers, all wrapped by lib/http route(): session, Origin (CSRF) check, rate limit, Zod errors
lib/social        SocialPublisher interface + instagram / youtube / x / mock publishers, registry
lib/queue         job contracts, BullMQ or in-process backend, handlers, scheduled sweeper
lib/storage       local or S3 driver, signed URLs
lib/crypto        AES-256-GCM for OAuth tokens at rest
lib/ai            creative assistant: hooks, tone rewrites, platform copy (Gemini if keyed, offline otherwise)
components/create the creation workspace: journey rail, video stage, assistant, platform deck, launch, live publishing
```

Security: OAuth (state + PKCE where the platform supports it), encrypted tokens, same-origin checks on every mutation, per-user rate limits, Zod validation, ownership checks on every post, media and target query, and signed media URLs.

## Going live with real platforms

Read the platform section of `docs/INTEGRATION_STATUS.md` first (app review, paid X tier, YouTube audit). Then set `MOCK_SOCIAL_PUBLISHING=false` and fill the client ID and secret for each platform. Redirect URI: `${APP_URL}/api/accounts/<platform>/callback`. Instagram needs a Business or Creator account linked to a Facebook Page. YouTube needs the `youtube.upload` scope. X needs media upload access on your API tier.
