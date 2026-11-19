# Outlly Intelligence (lib/intelligence)

The Content Growth Engine behind the Content Intelligence page, the Growth Planner and Pip's `intelligence_overview`. Plan and history: `docs/INTELLIGENCE-AUDIT-R1231.md`.

## Module map

Pure (no I/O, no Prisma, safe in tests and on the client):

- `core.ts`: availability (unavailable, unsupported, zero), like-with-like format groups, topic index, signals, recommendation drafts, confidence.
- `reco-core.ts`: dedupe key, expiry, the number-preserving wording check.
- `planner-core.ts`: allowed actions and transitions, prefill.
- `outcome-core.ts`: an outcome against the same platform and format cohort.
- `brand-core.ts`, `categories-core.ts`, `prefill-core.ts`, `report-core.ts`: validation and shaping for their features.

Server (touch Prisma, `import "server-only"`):

- `service.ts`: loadPostRecords (one post query and one groupBy, 60 s cache, at most 2000 destinations) and overview.
- `memory.ts`: Content Memory and brand profiles.
- `reco.ts`: stored recommendations, the read-only `storedFor`, AI wording.
- `planner.ts`: act() and the audit trail.
- `outcome.ts`: outcome links, measurement, the sweep step.
- `lineage.ts`, `categories.ts`: content identity and categories.

## Invariants

- Deterministic numbers: every sum, median, lift and verdict is computed in a `*-core.ts` file. The same posts give the same answer.
- AI only rewords. The model never decides a number, a platform or a format; `validateWording` rejects any rewording that changes one. AI wording runs only with an AI grant covering `intelligence_wording`, at most 5 per call and 30 per owner per UTC day, and falls back to the rule text.
- Tenant isolation: every read and write is filtered by `ownerId` (and `scopeKey` for agency clients). Another owner's ids are answered as not found.
- Idempotent jobs: regeneration returns the existing row per rule, outcomes are written at most once per 24 hours, expiry runs again safely, and the sweep step is bounded and never fatal.
- Honest gaps: a metric a platform does not give is unavailable, never 0; claims need at least 3 posts and always carry a confidence; outcomes are early signals, never causes.
