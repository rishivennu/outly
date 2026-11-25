-- R1335: "Help improve Outlly AI" is opt-in and never preselected. R1324 had defaulted User.shareLearning to true for
-- every account; from R1335 the column is a mirror of the AiDataConsent record and is written only by
-- lib/intelligence/consent.ts. This resets every mirror that has no explicit granted decision behind it, so nobody
-- contributes to the shared model without having said yes. Idempotent: safe on every deploy (scripts/db-sync.mjs runs it
-- after `prisma db push`). Postgres only; the local SQLite dev database is recreated by tests.
UPDATE "User" u
SET "shareLearning" = false
WHERE u."shareLearning" = true
  AND NOT EXISTS (
    SELECT 1
    FROM "AiDataConsent" c
    WHERE c."userId" = u.id
      AND c."consentType" = 'shared-model'
      AND c.status = 'granted'
      AND c."createdAt" = (
        SELECT MAX(c2."createdAt") FROM "AiDataConsent" c2 WHERE c2."userId" = u.id AND c2."consentType" = 'shared-model'
      )
  );
