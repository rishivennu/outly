# Outlly Intelligence (lib/intelligence)

The Content Growth Engine behind the Content Intelligence page, the Growth Planner and Pip's `intelligence_overview`. Plan and history: `docs/INTELLIGENCE-AUDIT-R1231.md`.

## Module map

Pure (no I/O, no Prisma, safe in tests and on the client):

- `core.ts`: availability (unavailable, unsupported, zero), like-with-like format groups, topic index, signals, recommendation drafts, confidence.
- `reco-core.ts`: dedupe key, expiry, the number-preserving wording check.
- `planner-core.ts`: allowed actions and transitions, prefill.
- `outcome-core.ts`: an outcome against the same platform and format cohort.
- `brand-core.ts`: brand profile and agency client validation (scope keys, client account ids).
- `categories-core.ts`: category and topic validation.
- `prefill-core.ts`: a recommendation turned into a Content Studio draft (`/create?rec=`).
- `report-core.ts`: the Weekly Intelligence Report block (email and dashboard).
- `features-core.ts` (R1318): one published destination -> a versioned ContentFeatures row (counts and flags, never the copy) and PerfFeatures (derived totals; `measured` needs views and a day of age).
- `model/scorer-core.ts` (R1319): the `Scorer` interface and `baseline-ts-1` (cohort median shrunk toward a prior with n/(n+6), capped trait adjustments, cohort-spread range, no cohort row at or after asOf), plus `evaluate` / `accuracyWords`.
- `profile-core.ts` (R1318): ContentFeature rows -> CreatorProfileData (cadence, shares, medians, trait lifts) and the personalization ladder personal / blended / general / none.

Server (touch Prisma, `import "server-only"`):

- `service.ts`: loadPostRecords (one post query and one groupBy, 60 s cache, at most 2000 destinations) and overview. R1249: `scopeKey` ("" or a client) picks the brand profile and the scope recommendations live under; `accountIds` narrows the numbers.
- `memory.ts`: Content Memory, brand profiles and clients, the 180 day backfill (`sweepBackfill`, a sweep step at minute % 10 === 7).
- `reco.ts`: stored recommendations, the read-only `storedFor`, AI wording (admin grant or the `ai-insights` plan perk, 30 a day).
- `planner.ts`: act() and the audit trail.
- `outcome.ts`: outcome links, measurement, the sweep step.
- `lineage.ts`, `categories.ts`: content identity and categories.
- `learning.ts` (R1318): `logLearning` with dedupeKey. `client-scope.ts` (R1319): the ?client= rule (owner only, stored profile, the client's target ids).
- `model/predict.ts` (R1319): `syncPredictions` (forecast every destination from the history before it, actuals after 7 days, weekly IntelligenceEvaluation per platform, CreatorModelState calibration), `predictDraft` (POST /api/intelligence/predictions, stored only for the owner's own post), `predictionsOverview` (GET; `components/intelligence/PersonalBaselines.tsx`). GET /api/intelligence/platforms/:platform joins profile + baselines.
- `features.ts`, `profile.ts` (R1318): ContentFeature refresh (young posts daily, all on a FEATURE_VERSION bump), CreatorProfile rebuild per scope and platform with one CreatorProfileSnapshot a week, the LearningEvent log (`logLearning`, dedupeKey), ModelVersion baseline row, and `sweepPersonal` (sweep slot minute % 10 === 2, stalest owners first). Routes: GET /api/intelligence/profile, /status, POST /refresh. Plan: `docs/intelligence-clipper-plan.md`.

Elsewhere:

- `lib/pip/tools-intelligence.ts`: Pip's read-only `intelligence_overview` tool (workspace scope, overview in readOnly mode).
- `components/intelligence/*`: the dashboard. `view-core.ts` holds every gap, confidence and outcome word; `TopicInsights.tsx` (Topics section), `RecActions.tsx` (planner buttons on a card), `ClientSwitcher.tsx` (agency client picker, `?client=`).

## Invariants

- Deterministic numbers: every sum, median, lift and verdict is computed in a `*-core.ts` file. The same posts give the same answer.
- AI only rewords. The model never decides a number, a platform or a format; `validateWording` rejects any rewording that changes one. AI wording runs only with an AI grant covering `intelligence_wording` or a plan with the `ai-insights` perk (never Free by default), at most 5 per call and 30 per owner per UTC day, and falls back to the rule text.
- Tenant isolation: every read and write is filtered by `ownerId` (and `scopeKey` for agency clients). Another owner's ids are answered as not found.
- Idempotent jobs: regeneration returns the existing row per rule, outcomes are written at most once per 24 hours, expiry runs again safely, and the sweep step is bounded and never fatal.
- Honest gaps: a metric a platform does not give is unavailable, never 0; claims need at least 3 posts and always carry a confidence; outcomes are early signals, never causes.
- Predictions (R1319) are estimates from the creator's own measured posts: no measured post and no prior means null, never a number; every forecast names its model, level, sample and range, and is judged against the actual a week later. A model that cannot be evaluated yet says so.
