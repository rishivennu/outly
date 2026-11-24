#!/bin/sh
# R1312 Render entrypoint. Same order as a Vercel deploy: schema push (scripts/db-sync.mjs ran in the Vercel build),
# then the app. The cron scheduler replays vercel.json against this process (instrumentation-node.ts leaves the 15 s
# in-process sweeper off when RENDER is set, so nothing runs twice).
set -eu
cd /app
echo "[start] build ${RENDER_GIT_COMMIT:-?} on port ${PORT:-10000}"
bun scripts/db-sync.mjs
node scripts/cron-scheduler.mjs &
exec node node_modules/next/dist/bin/next start -p "${PORT:-10000}" -H 0.0.0.0
