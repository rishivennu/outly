# Outlly Intelligence Engine: plan-based access, consent, shared training and the admin ledger (R1334 to R1338)

The reference for how the Personal Intelligence engine is gated by plan, how creators consent to the shared model, what
the pipeline stores, what changed in the API, how upgrades and downgrades behave, and how to deploy or roll it back.
Plan and decisions: `docs/intelligence-entitlements-plan.md`. Consent and lineage detail: `docs/intelligence-consent.md`.
Module map: `lib/intelligence/README.md`. Android contract: `outlly-compose/docs/api-map-rest.md` A8.

## 1. Entitlement rules

- One plan perk, `personal-intelligence` (Admin > Pricing, per plan), turns the personal layer on. The five logical
  capabilities (`personal_intelligence_enabled`, `personalized_predictions_enabled`,
  `personalized_recommendations_enabled`, `personalized_clip_ranking_enabled`, `personal_learning_enabled`) are derived
  from it in `lib/intelligence/entitlements-core.ts` (`intelligenceAccessOf`), so a later split changes one function.
- Default placement (`lib/billing/pricing-preset.ts`): Creator and Agency (pro-manager, every perk) on; Starter and Free
  off. A plan made before perks existed (`perks` empty = every perk) has the engine when it is paid, never on Free.
- The check is server-side on every protected operation (`requireIntelligence(userId, capability)` in
  `lib/intelligence/entitlements.ts`): every gated `/api/intelligence/*` route, `predictDraft`, `personalRead`, the
  clipper's hints, Pip's forecasts, the weekly email section, and the sweep (`refreshScope` before any work). Nothing
  trusts a client flag or a cached plan.
- Denial = the existing structured 402: `{ error, code: "PLAN_LIMIT", feature: "intelligence", capability, upgrade: "/billing" }`.
  Each denial is logged once per owner, capability and UTC day as LearningEvent `entitlement_denied` and counted on the
  admin page (entitlement checks failed, unauthorized attempts).
- The pre-R1317 Content Growth Engine (overview, workspace recommendations, topics, history, feedback) stays on every
  plan. `/api/intelligence/insights` and `/pulse` answer softly (`entitled: false`, the door, no numbers).
- Free creators see the honest upgrade explanation on `/intelligence` (`IntelligenceUpgrade.tsx`, `UPGRADE_COPY`): what
  the engine does, never a locked card with fake numbers.
- Shared-model contribution is not a capability: it is consent (section 2), independent of the plan, so a free creator
  may contribute and a paid one may refuse.

## 2. Consent

- "Help improve Outlly AI" (`CONSENT_TITLE`, `CONSENT_EXPLANATION`, spec copy verbatim in `consent-core.ts`) is opt-in,
  never preselected: `User.shareLearning` defaults to false, every pre-existing row was reset to false by
  `supabase/migrations/0003_r1335_consent_mirror_reset.sql`, and an account with no decision has not consented.
- `AiDataConsent` is append-only: one row per decision (granted | withdrawn) with timestamp, policy version
  (`CONSENT_POLICY_VERSION`), categories (`content_metadata`, `performance_signals`, `production_signals`), source
  (settings | intelligence | onboarding | api) and the deletion request fields. The newest row is the state; the table
  is its own audit trail. `User.shareLearning` is a mirror written only by `lib/intelligence/consent.ts`.
- Surfaces: the switch under Your baselines (`SharingRow.tsx`) and Settings > Data & Privacy (`AiConsentCard.tsx`):
  title, explanation, categories, what is never included (`NEVER_INCLUDED`), status line, policy version, a two-step
  deletion request.
- Withdrawal stops new contributions at once and removes the creator's rows at the next hourly rebuild. A deletion
  request makes the next sweep tick rebuild at once, clears the creator's lineage references and is marked done.
- A new policy version needs a fresh decision (`state.current` false = ask again); nobody is carried over silently.

## 3. Data and migrations

New tables (both `prisma/schema.prisma` and `prisma/schema.template.prisma`; created by `prisma db push` through
`scripts/db-sync.mjs`, then locked by the RLS migrations):

| Table | Round | Holds | Retention |
|---|---|---|---|
| `AiDataConsent` | R1335 | one row per consent decision (see section 2) | with the account |
| `SharedDatasetBuild` | R1336 | one row per shared-model build: trigger, rows read / kept / rejected, buckets, validation, evaluation against the build before, served, duration, dataset version `sd-<seq>`, policy version, categories | 90 days (`pruneBuilds`) |
| `SharedContribution` | R1336 | one pseudonymous row per contributor (`contributorKey` = HMAC of the owner id, no user id), status, records, build references | cleared on deletion request |
| `IntelligenceJobRun` | R1337 | one row per engine job run (`personal`, `shared`, `predict`): trigger, ok, duration, counts, error text; no owner id | 30 days (`pruneJobRuns`) |

Reused: `Plan.perks`, `Subscription`, `PlanGrant` (the plan rule), `ContentFeature`, `CreatorProfile`,
`CreatorModelState`, `PredictionRecord`, `LearningEvent` (denials, consent events, backfill locks), `ModelVersion`
(`shared-baselines-1` is the production shared document). No table caches entitlements: they are computed from the live
plan on every call, so a downgrade cannot leave a stale grant behind.

Data SQL run once by `db-sync` after the push: `0003_r1335_consent_mirror_reset.sql` (`DATA_SQL` in
`scripts/db-sync.mjs`). No other backfill is needed: the shared document is rebuilt from current consent within the
hour, and personal profiles are rebuilt by the sweep or the upgrade kick.

## 4. API changes

| Route | Change |
|---|---|
| gated `/api/intelligence/*` (`profile`, `status`, `predictions` GET/POST, `recommendations`, `platforms/{platform}`, `refresh`) | 402 `PLAN_LIMIT` `{ feature: "intelligence", capability, upgrade }` without the perk (R1334) |
| `GET /api/intelligence/insights`, `GET /api/intelligence/pulse` | soft: `{ entitled: false, planName, upgrade, message }` (pulse adds `pulse: null, lines: []`) without the perk; `entitled: true` with it (R1334) |
| `GET /api/intelligence/sharing` | the consent view: `state`, `policyVersion`, `copy`, `categories`, `never`, `canChange`, `rules`, `history`, `contribution` (own lineage counts); `share` kept for the old shape (R1335, R1336) |
| `PATCH /api/intelligence/sharing` | owner only; `{ action: "grant" \| "withdraw" \| "request-deletion", source? }`; legacy `{ share }` accepted (R1335) |
| `GET /api/intelligence/status`, `GET /api/intelligence/predictions` | on the workspace scope add `coldStart` (no workspace profile yet) and `backfill` (`kicked` \| `fresh` \| `locked` \| `not-entitled` \| `no-posts`); the read kicks the upgrade backfill (R1338) |
| `POST /api/intelligence/predictions` | unchanged answer; each call is timed into `IntelligenceJobRun` `predict` (R1337) |
| `GET/POST /api/admin/intelligence` | governance JSON; `rebuild` is logged as `IntelligenceJobRun` `shared` trigger admin (R1337) |
| `/api/cron/sweep` | personal step and shared rebuild logged through `runJob`; job log pruned on the housekeeping slot (R1337) |

Android: `outlly-compose/docs/api-map-rest.md` section A8 carries the 402 body, the soft reads, the consent API and the
cold-start rule.

## 5. Jobs, retention and the admin page

- Personal sweep (`sweepPersonal`, minute % 10 == 2, 5 owners a run): features for an owner with the perk or consent,
  profiles / forecasts / model states / learning log only with the perk, nothing for neither (`skipped`). Every run is
  one `IntelligenceJobRun` `personal`.
- Shared rebuild (`sweepShared`, every tick, rebuilds once the document is 55 minutes old or a deletion is pending):
  consented creators' measured rows only, validated before serving (a failed document is replaced by an empty one and
  an AdminEvent is raised; an odd-looking one is served and flagged), recorded as a `SharedDatasetBuild`, lineage
  synced. Logged as `IntelligenceJobRun` `shared` when it ran.
- Upgrade backfill (section 6) is logged as `IntelligenceJobRun` `personal` trigger `api`; on-demand forecasts as
  `predict` trigger `api` (the measured latency).
- Retention: builds 90 days, job log 30 days, lineage cleared on deletion, personal rows with the account.
- Admin > Insights > AI Management (`/admin/intelligence/management`, area `intelligence`, super) reads
  `intelligenceManagement()` on every load: subscription distribution (the plan rule over every live subscription and
  grant), consent (opted in / out, withdrawals, by category, by policy version, deletion requests, stale mirrors), shared
  training (contributions, rejected, excluded without consent, dataset versions, production document, last run,
  evaluation, compute time: builds run inside the sweep, so the cost is time, not a bill), personal engine (profiles by
  level and freshness, retained after downgrade, entitled without profile, learning-job success rate, forecast latency
  p50 / p95), privacy (consent audit trail, deletion requests, retention against the oldest row, unauthorized attempts,
  isolation checks run against the live rows). Nothing is hardcoded; an unmeasured figure reads "not measured yet".
  Model governance (accuracy, drift, buckets, builds, versions) stays on `/admin/intelligence`.

## 6. Upgrade and downgrade

- Upgrade: the entitlement is live on the next call (no cache). The first `GET /api/intelligence/status` or
  `/predictions` on the workspace scope runs `kickBackfill` (`lib/intelligence/backfill.ts`): when the workspace profile
  is missing or older than 6 hours and the creator has a published post in the 90-day window, `refreshOwner` runs in the
  background (held open on Vercel through the request context), once per owner per 30 minutes (a LearningEvent
  `backfill_kicked` dedupe key is the lock). The read never waits for it and never fails because of it. Until the profile
  exists "Your baselines" shows the spec's cold-start line (`COLD_START_COPY`), never a made-up number. A read with a
  client scope selected does not kick anything (client profiles come from the sweep), and `coldStart` only describes
  whether the workspace profile exists; the plan gate runs before `kickBackfill`, so a free creator never sees either field.
- Downgrade: 402 at once on the gated routes, `intelligencePulse` null, the clipper falls back to neutral hints, the
  sweep and the backfill skip the owner (`not-entitled`). Every row (profiles, forecasts, model states, features,
  learning log) is kept and never updated; a re-upgrade resumes from them on the next read.
- Consent is untouched by either: a downgraded creator who consented keeps contributing; an upgraded one who did not
  stays out of the shared document.

## 7. Deployment and rollback

Deploy (in this order; `scripts/db-sync.mjs` does 1 to 3 on Render / Vercel build):

1. `prisma db push` adds the four tables and the `shareLearning` default (additive, no data loss).
2. Data SQL: `0003_r1335_consent_mirror_reset.sql` sets every `shareLearning` to false (idempotent).
3. RLS lock of the new tables (`0002_lock_all_tables.sql` pattern).
4. Ship the app. The first sweep tick rebuilds the shared document from consent (empty until someone opts in), writes the
   first job rows and registers the baseline scorer.
5. Admin > Pricing: confirm `personal-intelligence` on the plans that should carry it (Creator and Agency by default).
6. Check `/admin/intelligence/management`: access by plan matches the pricing intent, consent counts are zero or
   expected, the shared document is `active`, the job log fills over the next hour.

Rollback (each step independent, none destroys data):

- Entitlement too strict: untick the perk on no plan; instead add it to the affected plan in Admin > Pricing (live on the
  next call). Removing the gate wholesale is a code revert of R1334 (`requireIntelligence` calls); the data is untouched.
- Shared document wrong: Admin > Intelligence > Model versions, retire `shared-baselines-1` (served to nobody within 5
  minutes; personal estimates fall back to own data) or Rebuild now. The build log keeps every version's record.
- Consent reset unwanted: there is no automatic way back to opt-out-by-default, by design; a creator's decision is
  theirs. The old rows are not needed: consent is in `AiDataConsent`.
- Job log noisy or broken: `runJob` and `recordJobRun` never throw into the sweep or the routes; dropping the
  `IntelligenceJobRun` table only empties the admin page's job section.
- Backfill kick misbehaving: remove the two `kickBackfill` calls (status and predictions routes); the sweep rebuilds
  stale profiles within 10 minutes as before.

Verification after deploy: `tests/round-1334-*` to `round-1338-*` (entitlements, consent, lineage, admin management,
upgrade / downgrade) pass against the pushed schema; the admin page loads with real counts.
