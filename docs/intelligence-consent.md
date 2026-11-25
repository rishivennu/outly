# Intelligence: "Help improve Outlly AI" consent (R1335)

Phase 2 of `docs/intelligence-entitlements-plan.md`. How a creator's measured posts may enter the shared Outlly model,
what is recorded when they agree, and how they leave.

## What it is

An optional setting, off for everyone until they turn it on, independent of the plan:

> **Help improve Outlly AI**
> Allow Outlly to use eligible, de-identified product and content-performance signals to improve our shared AI models.
> This does not enable Personal Intelligence features on your account.

- Declining changes nothing else about the account.
- Connecting Instagram, YouTube, TikTok, Facebook or any other platform does not grant it.
- Saying yes does not unlock Personal Intelligence (that is the `personal-intelligence` plan perk, R1334).
- A paid creator may decline and keeps every personal feature.

## Where the creator sees it

- Settings > Data & Privacy > "Help improve Outlly AI" (`components/settings/AiConsentCard.tsx`).
- `/intelligence`: under Your baselines (paid) or on the upgrade card (free). Same component, `SharingRow.tsx`.

The row shows the switch (reflecting the server's state only, so never preselected), the explanation above, "What this
covers" (the three data categories with a sentence each, the aggregation floors, the never-included list), the status
line (off by default / on since date / withdrawn / deletion requested or done / "our explanation changed, please read
it again"), the policy version, and once a decision exists, "Remove my contributed data" with a two-step confirm.

## What is covered

Exactly what `lib/intelligence/shared.ts` reads today (`lib/intelligence/consent-core.ts` `CONSENT_CATEGORIES`):

| Category | Signals |
|---|---|
| `content_metadata` | platform, format, duration, publishing day and hour, gap since the previous post, cross-posting, content category |
| `performance_signals` | views and views per follower at set ages, engagement rate (only what the platform exposes) |
| `production_signals` | caption structure counts, hook type, hashtag / emoji / mention / link counts, cover and first-comment flags |

Never included, consent or not: uploaded videos or images, transcripts or captions as written, comments, messages or
anyone in the audience, credentials or platform tokens, unpublished drafts. A new category needs its own consent type
(`AiDataConsent.consentType`), not a wider reading of this one.

## The record

`AiDataConsent` (both `prisma/schema.prisma` and `prisma/schema.template.prisma`), append-only:

| Column | Meaning |
|---|---|
| `userId`, `consentType` | the creator and the consent (`shared-model` today) |
| `status` | `granted` or `withdrawn`; the newest row per user and type is the current state |
| `policyVersion` | `CONSENT_POLICY_VERSION` when the decision was made; a grant under an older version shows as "please confirm again" and still counts until they answer |
| `categories` | JSON array of the categories covered by that grant |
| `source` | `settings`, `intelligence`, `onboarding` or `api` |
| `consentedAt`, `withdrawnAt` | timestamps of the decision this row records |
| `deletionRequestedAt`, `deletionStatus`, `deletionDoneAt` | a deletion request and its progress (`requested` -> `done`) |

Every decision also logs a LearningEvent (`consent_granted`, `consent_withdrawn`, `consent_deletion_requested`).

`User.shareLearning` is a mirror of the current state, written only by `lib/intelligence/consent.ts` in the same
transaction as the row. Bulk readers (`rebuildShared`, admin counts) prefilter on it; `consentedOwnerIds()` then
checks the table, so a mirror with no granted decision behind it never contributes (and is counted as stale for the
admin page).

## Data migration

`prisma db push` (run by `scripts/db-sync.mjs` on every Vercel build) adds the table and flips the column default to
false. Existing rows keep the R1324 default-on value, so `supabase/migrations/0003_r1335_consent_mirror_reset.sql`
sets `shareLearning = false` for every user whose newest decision is not `granted`. db-sync runs it after every push
(`DATA_SQL`), before the RLS lock; it is idempotent and a failure stops the build. To run by hand:

```
prisma db execute --schema prisma/schema.prisma --file supabase/migrations/0003_r1335_consent_mirror_reset.sql
```

against `DIRECT_URL`. Rollback: the column and table are additive; reverting the code leaves the data harmless.

## API

`GET /api/intelligence/sharing` (any plan, any role):

```
{ state: { granted, current, policyVersion, categories, consentedAt, withdrawnAt, deletion, decisions },
  policyVersion, copy: { title, explanation, withdraw, deletion }, categories: [{ key, label, detail }], never: [...],
  share, canChange, rules: { minOwners, minPosts, windowDays }, history: [{ status, policyVersion, source, at, deletion }] }
```

`PATCH /api/intelligence/sharing` (owner only, 403 `OWNER_ONLY` otherwise) with
`{ action: "grant" | "withdraw" | "request-deletion", source? }` (the R1324 `{ share: boolean }` still works).
Returns the same view. Rate limit 20 a minute.

## Lifecycle

- **Grant**: new row, mirror true. Measured posts join the next hourly shared rebuild. Idempotent under the same policy
  version.
- **Withdraw**: new row, mirror false. Posts leave at the next hourly rebuild. Already published model versions were
  built from bucket medians (`shared-core.ts` publishes no row and no id), so there is nothing of the creator's in them.
- **Request deletion**: withdraws if needed, marks the request. The shared sweep (`sweepShared`, every tick) rebuilds at
  once instead of waiting for the hourly timer and marks the request `done`. R1336 adds the contribution lineage rows
  and purges them in the same step. A creator who never consented can still ask; the request is recorded and closed.
- **A new yes after deletion** is a fresh decision (new row) and closes any open request.

## Pipeline checks

- `rebuildShared` reads only `consentedOwnerIds()`; with no consent anywhere it stores an empty document, never
  "everyone".
- `refreshScope(ownerId).features` is true for the perk OR a granted consent (features are the shared model's input);
  profiles and forecasts need the perk.
- Nothing reads a client flag; the route reads no entitlement; `shared.ts` and `entitlements.ts` do not touch
  `shareLearning` directly.

## Admin

`/admin/intelligence` shows opted-in count and share, withdrawals and pending deletions (`intelligenceGovernance().participation`,
counts only). `consentSummary()` also gives never-asked, deletions done, by policy version, by category, stale mirrors
and 30-day decisions for the R1337 "AI Intelligence Management" section.

## Tests

`tests/round-1335-ai-consent.test.ts` (7): the state fold and copy; grant / withdraw append-only, idempotent, mirror in
step, history and events; the rebuild ignores a stale mirror; a deletion request forces the next sweep tick and is
closed; `refreshScope` follows the record; source pins (schema x2, db-sync data step, never preselected, Settings
mount, route reads no plan). `round-1324` and `round-1334` updated for opt-in.
