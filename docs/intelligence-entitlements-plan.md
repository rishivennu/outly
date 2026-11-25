# Plan-based Intelligence access, consent and shared-model lineage (R1334+)

Status: audit done 2026-11-25; phases ship one round each. Paths relative to `outly-main-audit/outly-next15`. Companion to `docs/intelligence-clipper-plan.md` (R1317) and `lib/intelligence/README.md`.

## 1. What the audit found

1. The personal layer (R1317 to R1330: ContentFeature, CreatorProfile(+Snapshot), PredictionRecord, CreatorModelState, IntelligenceEvaluation, LearningEvent, personal recommendations, the clipper's personal score, the Home pulse, Pip's `predictions`, the Monday email's baselines) runs for **every** owner. No route, sweep step or job checks the plan.
2. Entitlements already exist: `lib/billing/entitlements.ts entitlements(userId)` resolves the winning Subscription / PlanGrant / Free plan and exposes `perks: Perk[] | null` (admin-editable per plan in Pricing; `null` = every perk for plans made before 1096). `hasPerk` + a 402 `PLAN_LIMIT` error are the convention the web client (`lib/client/api.ts` upgrade popup) and the Android app already understand. `reco.ts` already gates AI wording this way (`ai-insights`).
3. Shared learning (R1324) reads measured ContentFeature rows of users with `User.shareLearning = true`, builds the anonymised bucket document (no id survives) and overwrites ModelVersion `shared-baselines-1` in place every 55 minutes. **`shareLearning` defaults to true**: contribution is preselected, which this spec forbids. There is no consent record (timestamp, policy version, categories, withdrawal), no per-build dataset version and no contribution lineage.
4. The pipeline the spec describes largely exists in miniature: consent filter (`optedOutIds`), schema version (`FEATURE_VERSION`), de-identification (buckets only), dedupe (one row per destination), evaluation (`weeklyAccuracy`, `driftOf`), promotion gate (admin `status` active | retired, the active scorer cannot be retired). What it lacks is versioning per build, lineage and an audit trail.
5. No Python ML service, queue worker or Render host runs today (R1312 on hold); "training" is the deterministic TypeScript rebuild. Nothing in this plan needs new infrastructure.
6. Plans in the preset: free (perks `[]`), starter (`weekly-digest`), creator (six perks incl. `ai-insights`), pro-manager/Agency (every perk). Legacy plans store `""` = every perk.

## 2. Decisions (override any of these)

- D1. **One configurable capability, `personal-intelligence`, as a plan perk.** The five logical capabilities in the spec (`personal_intelligence_enabled`, `personalized_predictions_enabled`, `personalized_recommendations_enabled`, `personalized_clip_ranking_enabled`, `personal_learning_enabled`) are derived from it by one pure function and returned as a structured set, so the API shape is ready if the admin ever wants them split. Rule: a plan that lists its perks decides; a legacy plan (perks `null`) gets it when paid, never on Free. Nothing hardcodes a plan name or price.
- D2. **Default perk placement: Creator and Agency on; Starter and Free off.** Starter is the admin's call in Pricing (one toggle).
- D3. **Gate = existing 402 `PLAN_LIMIT` with `feature: "intelligence"`, `capability`, `upgrade: "/billing"`.** The spec allows "403 or a structured entitlement response"; 402 is the structured response both clients already handle. Reads that other cards depend on (`/pulse`, `/insights`) return `200 { entitled: false, upgrade }` with no numbers instead of failing, so Home and the app render an honest upgrade line, never a fake locked card.
- D4. **The pre-R1317 Content Growth Engine stays on every plan** (workspace recommendations, topics, outcomes, `/intelligence` page shell). It is "existing Outlly functionality". The paid boundary is the personal layer listed in finding 1.
- D5. **Consent flips to opt-in.** `shareLearning` default becomes false and every existing row is set to false; a creator who wants to contribute turns "Help improve Outlly AI" on (never preselected). Fewer rows in the shared baselines for a while is the honest price. Consent is a row per change in a new `AiDataConsent` table (type, status, policyVersion, categories, source, consentedAt, withdrawnAt); `User.shareLearning` becomes the derived current value used as the fast filter.
- D6. **Pseudonymous, not anonymous.** Contribution lineage uses `HMAC-SHA256(secret, userId)` truncated to 16 hex as the contributor id; the mapping is only derivable with the secret (env, never stored). Copy says "de-identified", never "anonymous" for the ledger; the published document stays aggregates only.
- D7. **Lineage granularity = contributor x build**, not row x build (50k rows x 24 builds a day is not a ledger anyone can read). Each build stores rows per contributor, platforms, consent id and the rejection counts by reason.
- D8. **Withdrawal and deletion are strong here.** The served artefact is rebuilt from scratch every hour from current consent, so a withdrawn creator's rows leave the live model at the next rebuild; builds older than 90 days are deleted. We state exactly this and promise nothing about past builds beyond their deletion.
- D9. **Upgrade backfill reuses `refreshOwner`.** When an entitled owner has no fresh profile, the first personal read kicks a background refresh (guarded by a per-owner lock) and the UI shows the spec's cold-start copy until it lands; the sweep continues to maintain it. Downgrade: every operation re-checks entitlement, so inference and learning stop at once; rows are retained (no deletion) so a re-upgrade resumes.
- D10. **Denied attempts are recorded** as LearningEvent `entitlement_denied` (one per owner per capability per UTC day) and counted on the admin page.

## 3. Phases

| Round | Phase | Ships |
|---|---|---|
| R1334 | 1 Entitlements | `personal-intelligence` perk; `lib/intelligence/entitlements-core.ts` (pure caps) + `entitlements.ts` (server: `intelligenceAccess`, `requireIntelligence`, denial log); every personal route, sweep step, clipper hint, Home pulse, Pip tool and weekly section gated; `/intelligence` upgrade card for non-entitled; sharing switch stays reachable; tests |
| R1335 | 2 Consent | `AiDataConsent` model, consent-core (policy version, categories, copy), consent service, `/api/intelligence/sharing` rewritten on consent (+ deletion request), Settings > "Data & AI" block, `shareLearning` default false + migration |
| R1336 | 3 Shared builds + lineage | `SharedDatasetBuild` + `SharedContribution` models; `rebuildShared` records a build with rejection counts; pseudonymous contributor ids; 90-day build retention; deletion exclusion |
| R1337 | 4 Admin | "AI Intelligence Management" on `/admin/intelligence`: subscription distribution, consent, builds, personal profiles, privacy, denied attempts; real counts only |
| R1338 | 5 Upgrade/downgrade + docs | first-read backfill kick, cold-start copy, downgrade tests, Android api-map, `docs/intelligence-entitlements.md` |

## 4. Data changes

Reused: Plan.perks, Subscription, PlanGrant, User.shareLearning (derived), ContentFeature, CreatorProfile, CreatorModelState, PredictionRecord, LearningEvent, ModelVersion.
New (Phase 2 and 3; both `prisma/schema.prisma` and `schema.template.prisma`): `AiDataConsent`, `SharedDatasetBuild`, `SharedContribution`. The spec's `intelligence_entitlements` is not a table: entitlements are computed from the plan on every call (a table would be a cache that can go stale on downgrade). `creator_intelligence_profiles` = CreatorProfile; `intelligence_learning_jobs` = LearningEvent + the sweep result.

## 5. Acceptance (tests per phase)

Free, no consent: personal routes 402, `/insights` and `/pulse` say not entitled, no profile rows written by the sweep, no contribution. Free, consented: still 402, rows join the next build, consent row auditable, withdrawal excludes at the next build. Paid, consented: personal works, contributions recorded under a pseudonym. Paid, not consented: personal works, no contribution. Upgrade: entitlement live at once, backfill kicked once. Downgrade: 402 immediately, rows retained. Security: another owner's ids are not found; a client-supplied plan is ignored; the sweep checks entitlement itself.
