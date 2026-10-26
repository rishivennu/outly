# fix-1026e-delete-env (upload after fix-1026b-email, or straight after the live code: it doesn't depend on 1026b)

5 files. Nothing to delete, no database change (removeMode is a text column; "deleting" is just a new value).

## 1. Deleting a post from a platform can no longer leave it looking live
Before: Outlly deleted the post on X/Facebook/YouTube/etc. first and saved that afterwards. If the save failed,
the post was gone from the platform but still showed as live, and pressing Delete again could fail (X answers
"deleted=false" for a post that is already gone).
Now:
- Outlly writes "deleting" on the post BEFORE calling the platform.
- After the platform deletes it, the save is retried 3 times.
- If it still can't save, you see "It's deleted from X, but we couldn't save that here. Press it once more to
  finish", and the next press completes it (a "not found" / "deleted=false" answer then counts as done).
- If the platform refuses, the marker is put back exactly as it was (a private YouTube video stays private).

## 2. Every platform's keys can come from Vercel env as a fallback
Admin > Social platforms still wins. New optional env vars (fill only if you prefer env over the admin page):
FACEBOOK_CLIENT_ID (Meta App ID), FACEBOOK_CLIENT_SECRET, THREADS_CLIENT_ID, THREADS_CLIENT_SECRET,
LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, TIKTOK_CLIENT_ID (TikTok "Client key"), TIKTOK_CLIENT_SECRET.

## Checks
tests/round-1026e-delete-order.test.ts (5 tests). Full suite 540 pass, 0 fail. tsc clean.
