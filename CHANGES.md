# fix-1031fg: DM permission switch + security hardening

Upload after 1031e (repo-sync-1027 + missing5). 21 files. Paths are relative to the repo root.
Checks on this PC: 736 tests pass (61 files), `tsc --noEmit` clean, `next build` exit 0.

## 1031f: "Ask for the messaging permission" switch (Admin > Social platforms)

Until Meta approves messaging, asking for the DM scopes makes Instagram/Facebook connect fail.
The switch lets you connect without them, and turn DMs back on after App Review.

- Instagram and Facebook each get a switch. ON by default (nothing changes until you turn it off). Press Save to apply.
- OFF: connect asks only for the posting/insights scopes; no DM webhook subscribe; inbox sync skips that
  platform; replies to old threads are paused with a friendly "switched off" message (no raw Meta error);
  the Messages tab shows "Direct messages are switched off until Meta approves messaging". This applies to
  creators who connected earlier too, and the admin note says so.
- Files: lib/settings.ts, lib/social/keys.ts (dmsOn), lib/social/instagram.ts, lib/social/facebook.ts,
  lib/accounts.ts, lib/messages/service.ts, app/api/admin/platforms/route.ts, app/api/messages/route.ts,
  app/(studio)/inbox/page.tsx, components/inbox/MessagesView.tsx, components/admin/PlatformKeysForm.tsx,
  tests/round-1031f-dm-switch.test.ts

## 1031g: security

1. **DOM XSS on /app-auth (high).** `/app-auth?to=...` passed the raw value into `location.replace()` in a
   normal browser, so a link like `/app-auth?to=javascript:...` ran the attacker's script as the signed-in
   visitor (proved in Edge), and `?to=https://evil.com` was an open redirect. Now only
   `/api/auth/google` or `/api/accounts/<platform>/connect` on this site are allowed (appAuthTarget).
2. **Open redirect after sign-in (medium).** `/login?next=/%09/evil.com` passed the old check; the browser
   drops the tab and goes to evil.com after login. AuthForm, GoogleButton, NativeBridge (push taps) and
   safeReturnTo now share one check (lib/safe-next.ts sameSitePath): single leading slash, no control
   characters, and the path must resolve to this site.
3. **Oversized direct uploads (low, Supabase storage only).** The Supabase signed upload can't pin a byte size,
   so a client could reserve a small file, upload a huge one and never call complete. The minute sweeper
   (/api/cron/sweep) now fails an "uploading" row whose object is bigger than its reservation (after 15 min) or
   that was abandoned for a day, and only then deletes the object. The row is claimed first, so an upload that
   finishes at the same moment keeps its file.
- Files: lib/safe-next.ts (new), lib/oauth-state.ts, components/auth/AuthForm.tsx, components/auth/GoogleButton.tsx,
  components/app/AppAuthBridge.tsx, components/shell/NativeBridge.tsx, lib/queue/handlers.ts,
  app/api/cron/sweep/route.ts, tests/round-1031g-security.test.ts

## Also do (dashboard, not code)
- R2/S3: keep the bucket rule that aborts incomplete multipart uploads after 7 days (R2's default), so parts from abandoned uploads don't pile up.
- Supabase > Storage > your bucket > set "Restrict file size" to your biggest plan's upload limit (blocks oversized uploads at the source).
- Rotate the GEMINI key and confirm UPSTASH_REDIS_REST_URL/_TOKEN are set on Vercel (rate limits are per-instance without them).
- Admin login has a password only; keep it long and unique.
