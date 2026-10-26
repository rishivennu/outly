# fix-1026d-admin-tz (upload after fix-1026c-platform-delete)

Bug found on the live admin: React hydration errors #425 / #422 on /admin/outbox, /admin/updates and /admin/behavior.

Cause: dates were formatted with the machine's time zone. Vercel renders in UTC, the browser in IST, so the
server HTML and the browser text differ ("26 Oct, 8:00 pm" vs "27 Oct, 1:30 am") and React throws.

Fix: every admin date formatter is pinned to `timeZone: "Asia/Kolkata"` (fmtDate in ui.tsx, Outbox, Updates,
Waitlist/Maintenance "On since", ticket thread, lead lists). Same text on server and client, always IST.

Tests: tests/round-1026d-admin-tz.test.ts. Full suite 521 pass, tsc clean.
