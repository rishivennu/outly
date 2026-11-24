# AI Shorts Clipper (`lib/clipper`)

System B of the Personal Intelligence + Clipper plan (`docs/intelligence-clipper-plan.md`). A long video goes in;
ranked moments come out; the creator approves, trims, reframes and renders 9:16 clips; each clip can become a Post.

## Rounds

| Round | What |
| --- | --- |
| R1321 | Schema (`ClipJob`, `ClipTranscript`, `ClipCandidate`, `GeneratedClip`, `ClipEvent`), pure cores, service, API. |
| R1322 | Browser executor + `/clipper` studio screens (planned). |
| R1323 | Publish through the Create flow, performance feedback into Intelligence (planned). |

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
| `POST jobs/:id/detect` | Rank moments. Gemini when the key, the entitlement (or an AI grant on "other") allow. |
| `POST jobs/:id/candidates` | Cut by text `{ query }`. |
| `GET/POST jobs/:id/clips` | Clips of a job; manual clip `{ start, end, title }`. |
| `POST jobs/:id/cancel` | Cancel. |
| `POST candidates/:id` | `{ action: approve | reject }`. |
| `GET/PATCH/DELETE clips/:id` | Read, edit, discard. |
| `POST clips/:id/render` | `rendering`, `rendered { mediaId }` (owned video Media), `failed { error }`. |
| `POST clips/:id/regenerate` | Redraft copy from the clip's words. |
| `GET clips/:id/download` | The rendered Media view (409 until rendered). |
| `GET clips/:id/events` | Audit trail. |

## Executor model

The job table knows an `executor` (`browser` in v1, `worker` later). Hosting has no ffmpeg and 60 s functions, so
v1 transcribes (`lib/client/captions.ts`) and renders (canvas + MediaRecorder) in the creator's tab and reports
through `/stage` and `/render`. A job whose executor has not reported for 5 minutes is **stalled** and the screen
offers to resume. Nothing in the data model changes when a worker takes over.

## Honesty

Candidates are never shown without a reason; the detector is named (`ai` or `rules`); the personal weight only
moves a score when the creator's own history has a measured lift; copy is drafted from the transcript, not invented.
