# Outlly: integration status and risk audit

Last updated: 2026-10-11. This page is deliberately blunt. "Built" means the code exists and passes automated tests
against fakes. "Verified live" means it was exercised against the real service in this environment.

## Summary

| Area | Built | Verified live | Blocker to go live |
|---|---|---|---|
| Supabase Auth (email + password) | Yes | Yes: demo account migrated into the real project on sign-in; wrong password rejected (401) | Email confirmation is skipped (see below) |
| Supabase Storage (private bucket, direct + resumable upload) | Yes | Yes, through the app: signed direct upload, server size + magic-byte check, idempotent complete, thumbnail, fake-MP4 rejected (415), 60 MB refused (413). Browser TUS verified in Edge with a 13 MB file: 3 x 6 MB chunks, live % and ETA, no console errors. Resume-after-reload is implemented but was not exercised live | Free plan caps objects at 50 MB |
| Supabase Postgres | Schema ready | **No** (app still runs on local SQLite) | Need the database password / connection string |
| Row Level Security | Every public table locked by `supabase/migrations/0002_lock_all_tables.sql` (RLS on, restrictive deny for anon/authenticated, grants revoked) | Yes, the build runs it after each `prisma db push` | Tested on a real Postgres in `tests/round-1053-rls.test.ts` |
| Instagram Reels publishing | Yes | **No** | Meta app + app review, professional IG account |
| YouTube Shorts publishing | Yes | **No** | Google Cloud OAuth client; audit to post publicly |
| X video posting | Yes | **No** | Paid X API tier (Basic or higher) |
| Background worker | Yes (in-process in dev, BullMQ with `REDIS_URL`) | In-process only | A Redis instance for production |
| Review before publish (approval links) | Yes | Partly: token/expiry/one-decision/gate covered by tests; the public page was not clicked through in a browser | None — it needs no platform credentials |
| Comments inbox (read + reply) | Yes | **No** for real platforms; practice accounts work end to end in tests | Same OAuth blockers as publishing, plus `youtube.force-ssl`, `instagram_business_manage_comments`, and a paid X tier for conversation search |
| Automated tests | 97 tests, `bun test` | Run green on 2026-10-11 | n/a |

**No post has been published to a real platform from this build.** `MOCK_SOCIAL_PUBLISHING=true` and no platform
credentials are configured. Every connected account today is a **practice account** (id starts with `mock-`): it
rehearses the full flow, is labelled "Practice" in the UI, never gets a link, and is never counted as a real post.

## Mock vs real: how they are kept apart

- An account's own id decides, not a global switch (`lib/social/registry.ts` `publisherForAccount`):
  - `mock-*` account: always goes through `MockPublisher`, even if real credentials exist.
  - Any other account: always goes through the real API, even if `MOCK_SOCIAL_PUBLISHING` is flipped back on.
  - A real account with missing credentials **fails** with NOT_CONNECTED. It never falls back to a fake success.
- `PostTarget.practice` is synced on every job, and the UI shows practice runs as "Practice run, nothing was posted".
- Failure simulation (`studio_sim` cookie) only affects practice accounts.
- Covered by `tests/registry-crypto.test.ts` and `tests/publishing.test.ts`.

## Publishing state machine

Per platform: `queued -> uploading -> processing -> published | failed` (plus "needs reconnect" on the account).
The post status is derived from its targets (`derivePostStatus`): draft, scheduled, publishing, published, partial, failed.

Guarantees, each with a test:
- **Published only on platform confirmation.** The single path to `published` is a `published` answer from the
  platform (`applyRemote`) or a post we found on the platform during reconciliation.
- **Retry only the failed platform.** `retryTarget` refuses non-failed targets and needs a connected account.
- **Idempotent retries.** The platform upload handle (`uploadRef`) is kept, so a retry skips the re-upload. YouTube
  resumable sessions (`session:<url>`) resume from the last byte. A retry after MEDIA_REJECTED or an account
  change starts fresh.
- **Timeout reconciliation.** `publishRequestedAt` is written just before the irreversible publish call. If a later
  attempt sees it set, it first asks the platform (`findExisting`) whether the post already exists and records it
  instead of posting twice. A DUPLICATE response triggers the same lookup.
- **Automatic retries** only for NETWORK / RATE_LIMITED / PLATFORM_DOWN, at most 3, backoff 1.5 s, 3 s, 6 s.
- **Scheduling is UTC and claimed atomically** (`updateMany ... where status = scheduled`). Two workers firing at once
  publish once. A sweeper re-enqueues anything due after a restart.
- **Expired tokens** mark the account `needs_reconnect`, and only that platform fails (post becomes `partial`).

## Platform by platform

### Instagram Reels (`lib/social/instagram.ts`)
- Flow: Instagram Login OAuth -> long-lived token (60 days, refreshed) -> create REELS container with `video_url` ->
  poll container `status_code` -> `media_publish`.
- Scopes: `instagram_business_basic`, `instagram_business_content_publish`.
- Requirements and risks:
  - Only **professional (Business/Creator)** accounts can publish via the API.
  - Before other users can connect, the Meta app needs **App Review** for `instagram_business_content_publish`. Until
    then only accounts added as app testers work.
  - Instagram **pulls** the video from `video_url`. We give it a Supabase signed URL valid for 6 hours. Local storage
    URLs on `localhost` will not work for real publishing.
  - Duplicate guard: the caption is matched against recent media (best effort; two identical captions could collide).
  - Rate limit: about 50 API-published posts per account per 24 h (Meta's published limit).

### YouTube Shorts (`lib/social/youtube.ts`)
- Flow: Google OAuth web client (`access_type=offline` for a refresh token) -> resumable upload to `videos.insert` with checkpointing ->
  poll `processingDetails`.
- Scopes: `youtube.upload`, `youtube.readonly`.
- Requirements and risks:
  - **Unaudited API projects can only upload as Private.** Outlly detects "processed but private" and reports it as
    FORBIDDEN with an explanation, instead of claiming a public Short. Fix: complete Google's API audit.
  - Quota: 10,000 units/day by default and an upload costs about 1,600, so roughly 6 uploads/day per project.
  - Shorts classification is decided by YouTube (vertical, up to 3 minutes). We can't force it.
  - Duplicate guard: not implemented for YouTube (no reliable lookup). The resumable session avoids most double uploads.

### X (`lib/social/x.ts`)
- Flow: OAuth 2.0 with PKCE -> chunked media upload (`/2/media/upload/initialize`, `/append`, `/finalize`, then STATUS polling) -> `POST /2/tweets`.
- Scopes: `tweet.read tweet.write users.read media.write offline.access`.
- Requirements and risks:
  - **Media upload and posting need a paid API tier** (Basic or higher). On Free, X returns 403, which we report as
    FORBIDDEN ("account doesn't have permission"), not as an expired login.
  - Videos up to 140 s on standard accounts. Captions up to 280 characters.
  - Duplicate guard: recent timeline tweets are matched by media key.

## Supabase

- **Auth**: identities live in Supabase Auth (`lib/auth-provider.ts`). Our `User` row links by `authId` and stores no
  password. Pre-Supabase local accounts migrate on their first successful sign-in. Sessions are still Outlly's own
  HttpOnly JWT cookie (`studio_session`), so the Supabase access token never reaches browser JS.
  - Signup uses the admin API with `email_confirm: true`, so no email verification is sent. Before public launch,
    either enable SMTP and switch to the normal signup flow, or accept that risk knowingly.
- **Storage**: private bucket `media`, 50 MB per object (Free plan), MP4/MOV/JPEG only. Browsers upload straight to
  Supabase with a one-time signed token (simple PUT up to 6 MB, TUS resumable above that with resume after a refresh
  or dropped connection). The server then checks the real size and MP4/MOV magic bytes before accepting it.
- **Postgres**: not connected yet. Steps once the password is available:
  1. Set `DATABASE_PROVIDER=postgresql`, `DATABASE_URL` (pooler :6543, `?pgbouncer=true&connection_limit=1`) and
     `DIRECT_URL` (:5432). Run `bun run scripts/prisma-provider.mjs` then `prisma db push`.
  2. Run `supabase/migrations/0001_rls.sql`.
  3. Re-seed or migrate data. SQLite data is not moved automatically.

## Security notes

- OAuth tokens are AES-256-GCM encrypted at rest (`lib/crypto.ts`), decrypted only inside jobs, never sent to the
  client (tested).
- The secret key and platform client secrets are server-only env vars. `.env` is git-ignored; `.env.example` has no
  secrets.
- **Rotate the Supabase secret key** that was pasted into chat during setup (Project Settings -> API -> secret keys).
- All mutating API routes enforce same-origin, an authenticated session and rate limits (`route()` wrapper).

## Known gaps

- Real publishing untested end to end (credentials needed for all three platforms).
- Postgres + RLS not applied (DB password needed).
- Server-side ffmpeg processing is skipped with Supabase storage (no local file), so duration and size come from the
  browser and the magic-byte check. Thumbnails are generated in the browser and stored in the bucket.
- In-process queue jobs are lost if the server restarts mid-job. The sweeper recovers scheduled posts, but in-flight
  uploads need a manual retry. Use Redis + `bun run worker` in production.
- `/api/files` only serves the local driver. With Supabase, files are served via signed URLs.

## Review before publish

- `ReviewRequest` stores only a SHA-256 hash of the link token (`lib/review.ts`); the raw token is returned exactly
  once, by `POST /api/posts/{id}/review`, and is never written to the database or a log.
- The public page `/review/{token}` needs no session (allowed in `middleware.ts`) and is `noindex`. It shows the
  video, the per-platform copy, and the creator's name — nothing about the account.
- One decision per link, enforced by a conditional update, so two reviewers racing produce one verdict. Links expire
  after 7 days.
- `Post.requireApproval` gates both paths: `launchPost` throws `NEEDS_APPROVAL` (409) for "now" **and** "schedule",
  and `SCHEDULED_POST` skips an unapproved post, leaving it scheduled so it goes out as soon as approval lands.
- Not done: no email is sent (copy the link yourself), no per-account default setting, no reviewer identity beyond
  the typed name.

## Comments inbox

- `SocialPublisher.listComments` / `replyToComment` are optional; a platform that cannot do it is reported, not faked.
- YouTube `commentThreads.list` + `comments.insert`, Instagram `/{media}/comments` + `/{comment}/replies`,
  X recent search on `conversation_id` + reply tweet. Response mapping is unit-tested against a fake `fetch`;
  **no call has ever been made to a real platform.**
- X recent search needs the Basic tier; its 403 is shown as FORBIDDEN with plain copy, never as "reconnect".
- Practice accounts get deterministic comments from `MockPublisher`, labelled "Practice", with replies held in memory
  only. A real account never receives invented comments: a failure is shown with the platform's own words behind a
  disclosure.
- Comments are cached 60 s per target (`lib/inbox.ts`); a reply invalidates that target.
