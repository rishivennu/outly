#!/bin/bash
# 1113: Vercel "Ignored Build Step" (vercel.json ignoreCommand). Exit 0 = skip this build, exit 1 = build.
# Every build Vercel keeps holds its own copy of all server functions, which is what counts toward the Hobby
# plan's Functions Storage. So only build what can reach users:
#   - production (main) always builds, except a commit that only touches docs, notes or tests;
#   - preview branches build only when the commit message contains [preview].
if [ "$VERCEL_ENV" != "production" ]; then
  case "$VERCEL_GIT_COMMIT_MESSAGE" in
    *"[preview]"*) echo "Preview requested with [preview]: building."; exit 1 ;;
    *) echo "Preview build skipped (add [preview] to the commit message to build one)."; exit 0 ;;
  esac
fi
# If HEAD^ is missing (first commit, shallow clone) git diff fails and we build, which is the safe side.
if git diff --quiet HEAD^ HEAD -- . ':(exclude)*.md' ':(exclude)tests/**' ':(exclude)docs/**' 2>/dev/null; then
  echo "Only docs or tests changed: build skipped."
  exit 0
fi
exit 1
