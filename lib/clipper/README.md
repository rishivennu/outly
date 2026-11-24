# AI Shorts Clipper (`lib/clipper`)

System B of the Personal Intelligence + Clipper plan (`docs/intelligence-clipper-plan.md`). A long video goes in;
ranked moments come out; the creator approves, trims, reframes and renders 9:16 clips; each clip can become a Post.

## Rounds

| Round | What |
| --- | --- |
| R1321 | Schema (`ClipJob`, `ClipTranscript`, `ClipCandidate`, `GeneratedClip`, `ClipEvent`), pure cores, service, API. |
| R1321 review | Transcript save and detection flip the stage inside their transaction; a `rendered` report is accepted only while the clip is `rendering` (edits make it `pending`, so stale renders are refused with `STALE_RENDER`); source, trashed and already-used media are not renders; `ruleWindows` covers the whole source; candidates per job capped at 60; `ClipJob.media` is `SetNull` so purging the source keeps the clips; heartbeat progress is a fraction 0..1; `?transcript=1` on the detail. |
| R1322 | Browser executor (`lib/client/clipper.ts`: probe, transcribe through the Caption Studio chunks, detect, render 1080x1920 through `drawFor`, upload, report) + `executor-core.ts` (tab limit 40 min, screens, words) + `/clipper` studio (`components/clipper/*`: upload, processing with resume, review with reasons, editor with live reframe preview, export, download). Nav entry after Create. |
| R1322 review | A queued job with no tab is `stalled` (Resume) and the studio re-judges the screen every 30 s; Stop reports `failed: "Stopped."` so a clip never stays `rendering`; a `STALE_RENDER` 409 after the upload bins the file; the render waits for the caption font, ends on abort/error/20 s without a frame, and releases the `<video>`; files capped at 1.5 GB and the soundtrack decode keeps the heartbeat; the editor keeps edits across refreshes (reset on `id+updatedAt`), stops an export on unmount, warns on tab close, slides tall sources on `y`, takes decimals in the range boxes (`previewStyle` is the tested mapping); the studio never marks another tab's job failed on 409, carries Cancel through the upload, and reads a fresh URL on Resume. |
| R1323 | Publish through Create: `GET clips/:id/publish` hands the composer the rendered Media and the words (`publish-core.ts clipPrefill`), `/create?clip=<id>` sets it as the video and fills the caption/hook when the boxes are empty; the first save carries `clipId` (savePostSchema), `/api/posts` links `GeneratedClip.postId` (`attachClipToPost`, idempotent, quiet) and files the post in Content Memory with origin `clipper`. Reading clips (`clipsWithPosts`) is when a clip learns its post went out: status `published`, ClipEvent `published`, LearningEvent `clip_published` (deduped, dated at publish). `GET clips/:id/performance` reads the post's destinations from the latest TargetMetric rows (`platformPerformance`: unavailable is null, never 0; `performanceLine` is the one row sentence). Clip rows: Post this clip / Open post + the line. |
| R1323 review | Numbers are the **sum** of a destination's TargetMetric deltas (`groupBy`, like the feature store), destinations taken down through Outlly are left out, and a summed 0 for a metric the platform reports late (`LAGGING`: YouTube shares) is unavailable, not zero. A `partial` post promotes the clip too and `performanceLine` names the failed destinations. A clip with a post keeps its cut (`updateClip` 409 `HAS_POST` for range/reframe/subtitle; words still editable) and cannot be discarded (`HAS_POST`; Discard hidden). `attachClipToPost` also refuses discarded/unrendered clips and a post whose video is not the clip's render (`media_mismatch`); `/api/posts` runs the attach first and files origin `clipper` only on a real link; Create drops `clipId` when a new file is chosen, keeps a `?rec=` origin alongside, and a clip that already has a post (409 `ALREADY_POSTED` + postId) opens that post; a clip whose post was deleted is unlinked and can be posted again. PerformanceLine has an error state and refetches on `updatedAt`. |
| R1326 | Hardening: `retention-core.ts` + `retention.ts` (`sweepClipper` on the housekeeping slot: running jobs with no report for 7 days are cancelled as `abandoned`, transcripts go 90 days and suggested/rejected candidates 30 days after a job closes, 500 rows per table a run); `budget-core.ts` + `budget.ts` (per-user daily AI cap from the cost ledger, 30 calls / ₹40 by default, `CLIPPER_DAILY_CALLS` / `CLIPPER_DAILY_INR`; over it `POST jobs/:id/detect` runs the rule detector and answers `budget`); the review notes and sweep bounds below. |
| R1328 | Review fixes: a FAILED job keeps its transcript (it can be retried at its stage; nothing re-transcribes), queued jobs nobody started for 7 days are abandoned like quiet running ones (both hold a slot), every delete repeats its condition next to the ids (an approve or a retry between read and write is kept), abandon events are one `createMany` after the loop and the step takes `ABANDON_BATCH` (100) jobs; the budget counts AI detection **runs** (`detected` events, detector `ai`) instead of ledger rows, and a budget that cannot be read fails closed to the rules (`reason: unavailable`); Pip's queue cards show queued and failed, routing sends "the clipper is broken" to help; the scoped pulse (teammate, `?client=`) carries no workspace clipper counts and `GET /api/intelligence/pulse` narrows a scoped teammate; the Monday email's baseline links are absolute; the pulse-style Home renders the card once. |

## Files

- `settings-core.ts`: limits (source up to 2 h / 2 GiB, clips 8..90 s, up to 12 candidates, 2 active jobs per owner),
  `settingsOf` (clamps anything posted), `sourceProblem`, and the job **state machine** `nextState(cur, event)`:
  `queued -start-> running/transcribe -transcribed-> running/detect -detected-> ready/review -reviewed-> ready/done`,
  with `fail`, `retry`, `cancel`. A transition that is not in the table is a 409, never a silent overwrite.
- `reframe-core.ts`: 9:16 maths. `drawFor(w, h, plan)` gives integer source and destination rectangles for a
  1080x1920 canvas; `crop` slides a vertical window by `x`, `pillarbox` fits the whole picture over a blurred copy.
  Speaker tracking is a v2 worker feature; nothing here claims it.
- `candidates-core.ts`: deterministic scoring. `hook .3, selfContained .25, length .2, density .1, personal .15`.
  The personal part comes from the creator's own lifts (`lib/intelligence`, `hintsFor`) and is neutral (0.5) when
  there is no history. `rankCandidates` fits ranges to the settings, drops the lower of two that overlap > 30 %,
  caps at 12 and numbers ranks; `widen` grows a phrase hit to whole lines and at least the shortest clip.
  Every candidate carries a `reason` that reads its own numbers back.
- `copy-core.ts`: `draftCopy(text, title, platforms)` drafts title, hook, caption and hashtags from the clip's own
  sentences. No model: it rewords, never invents. `#shorts` only when YouTube is a target.
- `executor-core.ts`: the pure side of the tab executor. `BROWSER_MAX_SEC` (40 min: the browser decodes the whole
  soundtrack in memory), `browserProblem`, `screenOf(job)` (upload / processing / stalled / failed / review / done),
  `workingWords`, `stalledWords`, `clampRange`, `cuesWithin`, `clipFileName`.
- `jobs.ts` (server-only): the service. Owner-scoped reads, idempotent `createJob` by `clientKey`, `moveJob` through
  the state machine with a conditional update, `saveTranscript` (words in either `{w,s,e}` or `{text,start,end}`
  shape), `detect` (Gemini through `AskJson` when allowed, else `ruleWindows`, said plainly in `detector`),
  `addTextCandidates`, approve/reject/manual, `updateClip` (a timing, reframe or subtitle edit makes the render
  `pending` again and drops the old media), `reportRender`, `clipDownload`, `clipEvents`.

## API (`app/api/clipper`)

| Route | Purpose |
| --- | --- |
| `GET/POST jobs` | List; create (201, or 200 for the same `clientKey`). 400 bad source, 409 too many active. |
| `GET jobs/:id` | Detail: job, source media, cues, candidates, clips. |
| `POST jobs/:id/stage` | Executor reports: `start`, `heartbeat`, `transcribed`, `fail`, `retry`, `reviewed`. |
| `POST jobs/:id/detect` | Rank moments. Gemini when the key, the entitlement (or an AI grant on "other") allow. R1326: `detector` names what ran and `budget` (`{ allowed, reason: ok | calls | money | unavailable, line, spend, cap }`, null without a key or entitlement) says when the daily cap (or a budget read that failed, R1328) made it the rules. |
| `POST jobs/:id/candidates` | Cut by text `{ query }`. |
| `GET/POST jobs/:id/clips` | Clips of a job; manual clip `{ start, end, title }`. |
| `POST jobs/:id/cancel` | Cancel. |
| `POST candidates/:id` | `{ action: approve | reject }`. |
| `GET/PATCH/DELETE clips/:id` | Read, edit, discard. |
| `POST clips/:id/render` | `rendering`, `rendered { mediaId }` (owned video Media), `failed { error }`. |
| `POST clips/:id/regenerate` | Redraft copy from the clip's words. |
| `GET clips/:id/download` | The rendered Media view (409 until rendered). |
| `GET clips/:id/events` | Audit trail. |
| `GET clips/:id/publish` | R1323: `{ clip, media, prefill }` for Create (409 `NOT_RENDERED`, 409 `ALREADY_POSTED` + `postId`, 404 `NO_MEDIA`). |
| `GET clips/:id/performance` | R1323: `{ clip, post, platforms[], line }`; summed deltas per destination; a metric the platform never gave is `null`. |

## Executor model

The job table knows an `executor` (`browser` in v1, `worker` later). Hosting has no ffmpeg and 60 s functions, so
v1 transcribes (`lib/client/captions.ts`) and renders (canvas + MediaRecorder) in the creator's tab and reports
through `/stage` and `/render`. A job whose executor has not reported for 5 minutes is **stalled** and the screen
offers to resume. Nothing in the data model changes when a worker takes over.

## Hardening (R1326)

### Retention

Rules in `retention-core.ts`, applied by `retention.ts sweepClipper(now)` every 5 minutes (housekeeping slot):

| What | When | Why |
| --- | --- | --- |
| Running job, no heartbeat for `ABANDON_DAYS` (7); queued job untouched for as long (R1328) | cancelled, `error` = the reason, ClipEvent `abandoned` (one `createMany` after the loop) | frees one of the owner's `ACTIVE_JOBS_MAX` slots (the count includes queued); a stall under 7 days is the creator's to resume |
| `ClipTranscript` | `TRANSCRIPT_RETENTION_DAYS` (90) after the job closed **for good** (cancelled or ready/done; `completedAt`, else `updatedAt`). A FAILED job keeps its transcript (R1328): it can be retried at its stage and detect needs the words; nothing re-transcribes on a retry | the heaviest rows (up to 40k words); clips keep title, copy and plans; afterwards Regenerate copy, Find in words, Add your own clip and approving a leftover candidate answer `NO_TRANSCRIPT` |
| `ClipCandidate` suggested / rejected | `CANDIDATE_RETENTION_DAYS` (30) after close (failed jobs included: a retry detects afresh) | approved candidates stay: a clip's candidate holds the reason and scores feedback learns from |

A job at `ready/review` is the creator's desk and is never pruned. The transcript and candidate steps read at most
`RETENTION_BATCH` (500) ids each and delete by id **and** the same condition (R1328), so a candidate approved or a job
retried between the read and the write is kept; the abandon step takes `ABANDON_BATCH` (100) jobs because it writes per
row, and its update repeats the condition so a heartbeat or a start landing mid-sweep keeps the job. There is no index on
`ClipJob(status, completedAt)` yet; the relation filter scans jobs each tick, which is fine at current size (add
`@@index([status, completedAt])` in both schema files before volume grows).

### Daily AI budget

`budget-core.ts budgetVerdict(spend, cap)`; `budget.ts clipperSpend(userId, now)` counts today's AI detection **runs**
(ClipEvent `detected` with detector `ai` by this actor; R1328, because one run can book 2-3 hedged model calls in the
ledger, or none when a call times out before usage) and sums `inrMinor` for feature `clipper` in the cost ledger
(R1315). Two caps, first hit wins: **calls** (safety net while a model has no unit price and books at ₹0) and
**money**. Defaults 30 runs / ₹40 a UTC day (the reset is 00:00 UTC, 05:30 IST, and the line says so), overridable
with `CLIPPER_DAILY_CALLS` and `CLIPPER_DAILY_INR` (rupees). The cap never blocks a job: detection falls back to the
rules and the response and the `detected` event carry the reason; the studio shows `budget.line` once over the
candidates (`detectNote`). The check precedes the run and the run is counted when it ends, so a day can overshoot by
the runs in flight at once (at most `ACTIVE_JOBS_MAX`). A budget that cannot be read fails **closed** to the rules
(`reason: unavailable`, R1328), never to unlimited AI. Keyed by the user the ledger books (the person detecting).

### Review notes (ownership, RLS)

- Every clipper table carries `ownerId`, and every read and write in `jobs.ts` filters by it (`ownedJob`,
  `ownedClip`, `updateMany({ where: { id, ownerId, ... } })`); routes pass `user.id` (the workspace owner) and
  `realUserId(user)` only for the actor on events. There is no path from a clip id alone to a row.
- Children (`ClipTranscript`, `ClipCandidate`, `GeneratedClip`, `ClipEvent`) repeat `ownerId` instead of trusting the
  join, so a wrong join can only narrow a result, never widen it.
- The database is reached through one Prisma role; Postgres row-level security is not on. If direct access (Supabase
  client, SQL console for staff) is ever added, enable RLS on these five tables with `owner_id = auth.uid()` policies
  and keep the service role for the sweep only; the schema needs no change for that.
- Media: `ClipJob.mediaId` and `GeneratedClip.mediaId` are `SetNull`, so purging a source or a render (account cleanup,
  trash) never orphans a job; `sourceProblem` refuses trashed or already-used media before a job starts.
- Idempotency: `(ownerId, clientKey)` on jobs, `candidateId` and `postId` unique on clips, `updatedAt` compare on
  edits (409 `CONFLICT`), stage flips inside the writing transaction.

### Sweep bounds

Steps of `/api/cron/sweep` this plan added, what bounds each one, and the slot it runs on:

| Step | Slot | Bound |
| --- | --- | --- |
| `sweepPersonal` (features, profiles) | minute % 10 == 2 | 5 owners a run; per owner up to 5 batches of 2000 PostTargets (`refreshFeatures`), `rebuildProfiles` for the workspace plus up to 50 client scopes (5000-row profile and 200-row groupBy pre-reads), then `syncPredictions` |
| `sweepOutcomes` | minute % 10 == 4 | 10 owners a run |
| `sweepBackfill` | minute % 10 == 7 | 5 owners x 100 posts |
| `sweepShared` | every tick | one `findUnique` read; rebuild only when the document is 55 min old; 50k rows, 180 days |
| `sweepClipper` | housekeeping (every 5 min) | abandon: 1 read + up to `ABANDON_BATCH` (100) conditional updates + 1 `createMany`; transcripts and candidates: 1 read x 500 ids + 1 conditional `deleteMany` each |
| `syncPredictions` | inside `sweepPersonal` per owner | scoring in batches of 50, at most 200 attempts; `history()` reads all of the owner's measured rows (unbounded) |

`tests/round-1326-hardening.test.ts` seeds 300 closed jobs (half failed, which keep their transcripts) and times one
`sweepClipper` pass with a 100-row batch under 3 s on SQLite as the regression line, then drains with the default batch;
the abandon step is the only per-row loop and takes `ABANDON_BATCH` jobs a run.

## Honesty

Candidates are never shown without a reason; the detector is named (`ai` or `rules`); the personal weight only
moves a score when the creator's own history has a measured lift; copy is drafted from the transcript, not invented.
