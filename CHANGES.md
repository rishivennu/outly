# fix-1014-perf: admin and analytics speed (2026-10-14)

Upload every file at the SAME path from the REPO ROOT (no extra app/app or components/components folder).
No database change and no new environment variable. tsc 0, 222 tests pass.

## Admin: the 1 second wait on every click
1. NEW app/admin/(panel)/loading.tsx: a skeleton appears the moment you click a sidebar link (Next prefetches it),
   instead of the old screen sitting still until the server in Sydney answered.
2. globals.css: the page fade is shorter (.18s, 4px) and the skeleton waits 120 ms before showing, so fast pages don't flash.
3. lib/admin/auth.ts: one admin database read per click, not two (the session check and the starter-password banner share it).
4. layout.tsx + lib/support/tickets.ts + api/admin/tickets/[id]: the open-tickets badge count is cached for 15 s and cleared when a ticket changes.
5. lib/cache.ts: an update made while a read is still loading can no longer be overwritten by the old value.
6. SearchBox.tsx: a spinner shows while results load, typing stays smooth, and Back/Forward no longer re-applies the old search.

## Analytics / YouTube loading slowly
7. lib/live/index.ts: the dashboard no longer waits for Gemini (that wait could run up to 2 x 15 s). Numbers and rule-based tips come back first.
   NEW api/platforms/[platform]/ideas: the Gemini ideas load afterwards, cached for 6 h until your posts' numbers move.
8. lib/live/index.ts: the live numbers are also kept in Vercel's shared data cache (90 s, served stale while it refreshes,
   refetched once older than 10 min), so a cold server or a different page doesn't call YouTube again.
9. lib/live/youtube.ts: all YouTube calls go out at once (the uploads list comes from the channel id), so it's 2 rounds of calls instead of 3,
   and the result is checked against the real channel.
10. lib/live/instagram.ts: same parallel loading. A note now says when some posts' numbers didn't load.
11. lib/analytics.ts: the overview query fetches only the numbers (not the title and thumbnail on every row) and is cached for 60 s.
12. PlatformDashboardView.tsx: shows "Gemini is reading your numbers..." only when it takes longer than 0.6 s.
13. NEW tests/live-youtube-speed.test.ts (3 tests).
