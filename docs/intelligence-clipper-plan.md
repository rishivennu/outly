# Personal Intelligence + AI Shorts Clipper: audit and phased plan (R1317)

Status: Phase 1 of the "Personal Intelligence + AI Shorts Clipper" master prompt. Audit only, no product code changed. Paths are relative to `outly-main-audit/outly-next15`. Everything below was read in this round; "unverified" marks a claim not confirmed in code.

## 1. Summary

1. Most of System A's foundation exists. The Content Growth Engine (R1231 to R1249, `lib/intelligence/*`, `docs/INTELLIGENCE-AUDIT-R1231.md`) already has ContentItem lineage, BrandProfile, Recommendation + RecommendationEvent (accept / edit / reject / save / done / feedback / outcome), a 180 day backfill, outcome measurement, a weekly report block, a Pip tool and the `/intelligence` page. The master prompt's "recommendation_history" and "learning events from recommendation feedback" are these tables.
2. What System A lacks is the per-creator profile layer: no CreatorProfile (global or per platform), no versioned per-post feature rows, no predictions, no model version, no evaluation, no explicit learning-event log beyond RecommendationEvent. Section 4 maps every logical entity in the prompt's §24 to reuse or new.
3. Per-post performance exists for Instagram, YouTube and Facebook only (`lib/insights/post.ts` `CAN`, `lib/analytics/sync.ts` `SYNCABLE`); TikTok, X, LinkedIn and Threads give no per-post numbers. Watch time and completion come from YouTube and Instagram/Facebook video insights only. Predictions and "what performs" can be honest only inside these three platforms; every other platform gets general guidance, never a personal prediction (§6 rule 4 of the prompt).
4. System B has a browser-side seed, not a server pipeline. Caption Studio transcribes in ~60 s WAV chunks (Groq Whisper, FunASR, Gemini; `lib/client/captions.ts`, `lib/ai/transcribe.ts`), `app/api/ai/highlights` picks moments from the subtitles with Gemini, and `components/create/ClipCutter.tsx` cuts and burns captions with canvas + MediaRecorder. Nothing is stored: no job, no candidate table, no clip row, no learning.
5. Hosting is the constraint that shapes System B. Production is Vercel serverless: 60 s `maxDuration`, no ffmpeg (`lib/media/probe.ts` degrades when the binaries are missing), no resident process. A BullMQ worker (`workers/index.ts`) and a Render Dockerfile with ffmpeg (`Dockerfile`, `render.yaml`, R1312, on hold) exist but neither runs today. Python / FastAPI / CatBoost: nothing in the repo (`rg python|fastapi` in Dockerfile, render.yaml, package.json: none).
6. Therefore the plan builds System B as a stored job model with a pluggable executor. Executor v1 runs in the browser (what ships on Vercel today, reusing Caption Studio and the burner); executor v2 is the Render worker with ffmpeg (face tracking, server render, longer files) once R1312 resumes. The API, tables, review UI and learning loop are the same for both.
7. The ML engine ships first as deterministic TypeScript (cohort medians, shrinkage toward the shared baseline, confidence from sample size), recorded under a ModelVersion row like any trained model. A CatBoost/LightGBM FastAPI service is an adapter behind the same interface, deferred until (a) a host that can run Python exists and (b) enough labelled rows exist (today the whole user base has per-post metrics on three platforms; a gradient-boosted model on a few hundred rows would be theatre).

## 2. What exists today

### 2.1 Data (prisma/schema.template.prisma; 118 models)

| Area | Models (line) | Notes |
|---|---|---|
| Content | Post :326 (format, story, storyMeta, hook, status, scheduledAt, publishedAt, coverKey), PostMedia, PostTarget (platform, platformPostId, title/caption/hashtags), Media :200 (duration, width, height, status, storageKey) | Raw truth for content features |
| Raw performance | TargetMetric :433 (views, likes, comments, shares, saves; increment snapshots), AccountSnapshot :1587 (followers, posts, views per day), AccountSyncState | Raw analytics stays here (prompt §24: raw separate from derived) |
| Lineage | ContentItem :1620, ContentVariation, ContentCategory, ContentItemCategory, ContentCampaign | R1233; backfill in `lib/intelligence/memory.ts sweepBackfill` |
| Brand | BrandProfile :1687 (objective, audience, pillars, tone, avoid, scopeKey per agency client) | The "creator_preferences" half that is explicit |
| Recommendations | Recommendation :1705 (dedupeKey, evidence JSON, confidence, status, wordedBy, feedback), RecommendationEvent :1733 | Already the audit trail the prompt asks for |
| AI metering | AiUsage :1090, FeatureUse :1104, AiFeatureUsage, CostEvent (R1315 token-level) | Clipper AI calls must go through `llmText` meter + `chargeAi` |
| Telemetry | ActivityEvent :2292, UsageSession, AnalyticsDaily | Admin side; not creator features |

### 2.2 Code

- Intelligence: `lib/intelligence/{core,reco-core,planner-core,outcome-core,brand-core,categories-core,prefill-core,report-core}.ts` pure; `{service,memory,reco,planner,outcome,lineage,categories}.ts` server. Invariants in `lib/intelligence/README.md`: deterministic numbers in `*-core.ts`, AI only rewords (`validateWording`), tenant filter by `ownerId` + `scopeKey`, idempotent sweep steps (`sweepOutcomes` at minute % 10 === 4, `sweepBackfill` at 7).
- Analytics honesty: `lib/analytics/core.ts` (`kpiMetrics` refuses cross-platform sums), `lib/insights/post-core.ts` (`MetricKey` includes reach, impressions, engagementRate, watchTimeMin, avgWatchSec; `unavailable[]`), `lib/analytics/trend.ts` thresholds.
- Scheduling: `lib/schedule/best-time*.ts` (publishing-time features).
- Video: `lib/media/probe.ts` (ffprobe/ffmpeg when present; `thumbnail`), `lib/ai/video-caption.ts` (Gemini frames + transcript -> story), `lib/ai/transcribe.ts` (`Transcript {cues, words, language, engine}`, `chargeRun`), `lib/captions/subtitle-engine.ts` (`Word`, `Highlight`, `cuesFromWords`, `findText`, `highlightPrompt`, `parseHighlights`), `lib/captions/cues.ts` (`Cue`, `toSrt`, styles pop/box/clean), `lib/client/captions.ts` (browser transcription chunks, `cutClips` burner), `components/create/ClipCutter.tsx`.
- Jobs: `app/api/cron/sweep/route.ts` every minute (Vercel Cron), slots in `lib/queue/plan.ts`; BullMQ queues `lib/queue/jobs.ts` (VIDEO_PROCESS, SOCIAL_*; optional, REDIS_URL) and `workers/index.ts`.
- Storage: `lib/storage/index.ts` `StorageDriver` (S3/R2/Supabase, signed URLs, multipart direct upload via UploadSession/UploadPart R1193).
- Publishing: Post -> PostTarget -> `lib/social/*` adapters, approvals (ReviewRequest), Create flow `components/create/CreateWorkspace.tsx` with `?rec=` prefill (`lib/intelligence/prefill-core.ts`).
- Admin kit for any admin surface: `components/admin/ui.tsx`, `lib/admin/route.ts adminRoute`, `lib/client/admin-api.ts`.
- Android (`outlly-compose/`, BRIEF.md): native screens mirror the studio routes including `intelligence`; it talks to the same `/api/*` routes. Shorts Clipper lands there as API first, screen later (prompt §31).

### 2.3 Hosting

| Capability | Vercel (prod today) | Render worker (R1312, on hold) | Browser |
|---|---|---|---|
| Request budget | 60 s | unbounded process | user's tab |
| ffmpeg | no | yes (`Dockerfile`) | no (canvas + MediaRecorder) |
| Python | no | possible (Dockerfile change) | no |
| Long-form upload | direct-to-bucket multipart already works | same | same |
| Transcription | 60 s chunks via `/api/ai/transcribe` | server-side chunks | chunks already implemented |
| Face tracking | no | yes (OpenCV/MediaPipe, later) | MediaPipe wasm (possible, later) |

## 3. Decisions

1. Reuse Recommendation + RecommendationEvent as `recommendation_history` and the feedback half of `learning_events`. Add a general LearningEvent table only for events those rows cannot express (publish, metric milestone, clip approve/reject/edit, prediction evaluated).
2. One CreatorProfile per (ownerId, scopeKey, platform) where platform "" is the global profile. Profiles are derived, versioned (`featureVersion`), rebuilt by a sweep step; never hand edited. Explicit preferences stay in BrandProfile.
3. ContentFeature: one row per Post (unique postId), `features` JSON string with `version`, computed from Post/PostTarget/Media/Transcript text; `perf` JSON from TargetMetric totals at 24 h / 7 d / 28 d. Raw TargetMetric stays untouched.
4. Predictions: PredictionRecord (postId or clipId, modelVersionId, predicted JSON, actual JSON when measured, error). ModelVersion rows for every scorer, including the TypeScript baseline ("baseline-ts-1"). IntelligenceEvaluation aggregates per model per owner per week. The Python/CatBoost service is an adapter behind `lib/intelligence/model/scorer.ts`; it is not part of the first six rounds.
5. Honest personalization levels (prompt §6): `personal` (>= 12 measured posts on that platform in 90 d), `blended` (4 to 11), `general` (1 to 3, labelled), `none` (0, no prediction). Constants in one `*-core.ts` file.
6. Shorts Clipper tables: ClipJob (the long-form source, state machine, resumable `stage` + `progress` JSON), ClipTranscript (words, cues, language, engine), ClipCandidate (start, end, type, scores JSON, rank, reason), GeneratedClip (approved candidate -> title, caption, hashtags, reframe JSON, subtitle style, render status, storageKey, postId when published), ClipEvent (edit history, approvals, renders, publish). Media rows keep storing the original upload and the rendered clip, so storage quota, trash and lifecycle (R1209) apply unchanged. Clip performance = the published Post's TargetMetric rows via GeneratedClip.postId; no separate snapshot table.
7. Executors: `lib/clipper/executor.ts` interface (`transcribe`, `detectMoments`, `render`) with `browser` v1 (the tab does the work and posts results to `/api/clipper/jobs/:id/stage`) and `worker` v2 (Render; BullMQ queue `media`). Jobs record which executor ran each stage.
8. 9:16 reframing v1 = centre crop with a per-clip adjustable x offset plus "blurred pillarbox" fallback; speaker tracking is a v2 worker feature. The UI never promises tracking until v2 exists.
9. All AI calls go through `lib/ai/llm.ts` with `meter: { feature, userId }` so R1315 attributes tokens; plan gates via `lib/ai/entitlements.ts` + `assertAiCaptions`. Clipper jobs count against upload quota like any Media.
10. Every endpoint lives under the existing conventions: `route()` from `lib/http`, scope via `lib/profiles.ts`, zod bodies, idempotency keys on job and render creation (unique `(ownerId, clientKey)`).

## 4. Entity mapping (prompt §24)

| Prompt entity | Decision | Target |
|---|---|---|
| creator_intelligence_profiles | new | CreatorProfile platform "" |
| creator_platform_profiles | new | CreatorProfile platform != "" |
| creator_behavior_snapshots | new | CreatorProfileSnapshot (weekly copy of a profile) |
| creator_preferences | reuse | BrandProfile (+ `prefs` JSON column for clip preferences) |
| content_features | new | ContentFeature (unique postId) |
| performance_snapshots | reuse | TargetMetric, AccountSnapshot |
| learning_events | reuse + new | RecommendationEvent; LearningEvent for the rest |
| personal_model_states | new | CreatorModelState (per owner per ModelVersion: calibration JSON) |
| model_versions | new | ModelVersion |
| prediction_records | new | PredictionRecord |
| recommendation_history | reuse | Recommendation + RecommendationEvent |
| intelligence_evaluations | new | IntelligenceEvaluation |
| original_videos | reuse | Media (+ ClipJob.mediaId) |
| video_processing_jobs | new | ClipJob |
| video_transcripts | new | ClipTranscript |
| video_scenes, video_speakers | new, v2 | ClipScene (worker executor only) |
| candidate_clips | new | ClipCandidate |
| generated_clips | new | GeneratedClip |
| clip_features | fold | GeneratedClip.features JSON, then ContentFeature once published |
| clip_edit_history | new | ClipEvent |
| clip_render_jobs | fold | GeneratedClip.renderStatus / renderError / renderedAt + ClipEvent |
| clip_publishing_history | reuse | GeneratedClip.postId -> Post -> PostTarget |
| clip_performance_snapshots | reuse | TargetMetric via postId |

## 5. API mapping (prompt §25)

Personal Intelligence (new `app/api/intelligence/*`, beside the existing `overview`):
`profile`, `insights` (alias of overview sections), `predictions`, `recommendations` (reads `lib/intelligence/reco.ts storedFor`), `history` (RecommendationEvent + LearningEvent), `status` (levels per platform, last refresh, backfill state), `platforms/[platform]`, POST `feedback` (wraps `planner.act`), POST `refresh` (rate limited, runs the owner's profile rebuild).

Shorts Clipper (new `app/api/clipper/*`): `upload` (returns the existing direct-upload session; the file is a Media), `jobs` (POST create idempotent by clientKey, GET list), `jobs/[id]`, `jobs/[id]/clips`, `jobs/[id]/cancel`, `jobs/[id]/stage` (executor callback, owner-authenticated), `clips/[id]` (GET, PATCH), `clips/[id]/regenerate`, `clips/[id]/render`, `clips/[id]/approve`, `clips/[id]/publish` (creates a Post via the existing composer path, never a second publisher), `clips/[id]/download` (signed URL).

## 6. Phases and rounds

| Phase | Round | Scope | Depends on |
|---|---|---|---|
| 1 Audit | R1317 | this document (pushed 9fa6aea) | |
| 2 Personal data foundation | R1318 (DONE) | schema: CreatorProfile, CreatorProfileSnapshot, ContentFeature, LearningEvent, ModelVersion; `lib/intelligence/features-core.ts` (feature extraction, versioned), `profile-core.ts` (aggregation, levels), `features.ts`/`profile.ts` server; sweep step (minute % 10 === 2) bounded backfill over published posts; `/api/intelligence/{profile,status}`; tests | 1 |
| 3 Personal intelligence engine | R1319 (DONE; Create Step panel moved to Phase 7) | PredictionRecord, CreatorModelState, IntelligenceEvaluation; `model/scorer.ts` interface + `baseline-ts` scorer (cohort medians + shrinkage + confidence); predictions on drafts in Create (Step 3 panel) and on `/intelligence`; weekly evaluation sweep; `/api/intelligence/{predictions,platforms/:platform,refresh}` | 2 |
| 4 Recommendation engine (personal) | R1320 (DONE) | `lib/intelligence/personal-reco-core.ts` (trait-lift and format-baseline rules over ModelState, honesty ladder, 2 per platform / 5 in all) + `personal-reco.ts` (stored through `reco.ts`, same ids/planner/expiry); `/api/intelligence/{recommendations,history,feedback,insights}`; `planner.act` logs LearningEvent `recommendation_<event>`; UI `PersonalRecommendations.tsx` ("Why this fits you" + "Your numbers"). Timing/cadence/topic rules deferred: the profile has shares for them, not performance splits yet | 3 |
| 5 Shorts Clipper | R1321 schema + service + API (DONE); R1322 browser executor + `/clipper` screens (DONE; `lib/clipper/README.md`); R1323 publish via Create (`/create?clip=`) + performance loop (`clipsWithPosts` flips `published` with a `clip_published` LearningEvent; `GET clips/:id/performance`) (DONE) | tables in §3.6; `lib/clipper/*-core.ts` (candidate scoring, duration/count rules, reframe maths, subtitle plan), executor interface, browser executor built on `lib/client/captions.ts`; `/clipper` studio route; publish via Create; GeneratedClip -> ContentFeature + LearningEvent | 2 (features), 4 (personal ranking) |
| 6 Shared learning | R1324 DONE | `lib/intelligence/shared-core.ts` + `shared.ts`: anonymised buckets (platform + format [+ category]) of views-per-follower / views / engagement medians, published only with >= 5 creators and >= 20 posts and no creator above half, one creator capped at 30 rows, stored as ModelVersion `shared-baselines-1` data; `User.shareLearning` opt-out (GET/PATCH /api/intelligence/sharing, owner only; switch under Your baselines); `predictDraft` / live model states take the shared prior below the personal level, scaled to the creator's followers (backfilled forecasts never do); admin `/admin/intelligence` (super): weekly accuracy across creators, drift, forecasts per platform, the buckets, model versions with activate/retire, rebuild now; hourly sweep slot (minute 12) | 3 |
| 7 App integration | R1325 | Pip tools (predictions, clipper status), Home pulse card, weekly report block, Android API notes in `outlly-compose/docs`, deep link `/clipper` | 4, 5 |
| 8 Hardening | R1326 | load tests on sweep steps, RLS review notes, retention (ClipTranscript 90 d, candidates 30 d after job close), cost caps per owner per day, docs | all |
| Later (needs Render) | R13xx | worker executor: ffmpeg render, scene detection, speaker tracking; Python FastAPI scorer adapter | R1312 resumed, data volume |

Each round: `tests/round-NNNN-*.test.ts`, tsc 0, pinned suites green, pushed on its own.

## 7. Risks, stated plainly

- Data volume: personal predictions need measured posts on Instagram, YouTube or Facebook. Most creators will sit at `general` or `none` for weeks. The UI must say so, never fill the gap with invented numbers.
- Browser executor limits: rendering a 60 s 9:16 clip with MediaRecorder takes about real time and depends on the tab staying open; files over roughly 2 GB or 2 h should be refused until the worker exists (constants in `lib/clipper/limits-core.ts`).
- Vercel: every clipper API call must finish in seconds; all heavy work is in the executor. Sweep steps keep their 10 s budgets.
- Cost: Gemini on long transcripts is metered (R1315). Candidate detection sends subtitles, never video frames, in v1.
- Scope: this plan does not ship face tracking, Python ML, or TikTok/X/LinkedIn/Threads per-post learning; those depend on infrastructure and platform APIs that are not there.
