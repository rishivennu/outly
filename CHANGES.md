# fix-1026-plans-beta: Free plan limits, upgrade pop-up, beta program, forgot password, UI fixes

Upload AFTER fix-1022e-scroll (cumulative on 1016 -> 1022e). Copy every file in this folder to the same
path in the repo, replacing the old one.

## Do these by hand in the repo
1. DELETE the four duplicate files at the repo ROOT (the real ones live in app/):
   `layout.tsx`, `globals.css`, `robots.ts`, `sitemap.ts`. They were stray copies and confuse builds.
2. Nothing else. The schema change (new Plan columns, FeatureUse, BetaCode, Post.launchedAt) is pushed
   automatically by the build's db-sync step, from prisma/schema.template.prisma. Existing Free plans are
   moved to the new limits on first start (migrateFreeLimits); paid plans are not touched.

## Free plan limits (all enforced on the server, HTTP 402 code PLAN_LIMIT)
| Limit | Free | Paid |
|---|---|---|
| Posts | 3 per week (Mon-Sun, ISO week). Drafts don't count | plan setting |
| Upload size | 50 MB per file (normal and direct uploads) | plan setting |
| Inbox replies | 10 per week | plan setting |
| AI caption videos | 2 (same video again is free) | plan setting |
| Burn captions into the video | not included | included |
How they can't be dodged: a post takes its slot when it is sent or booked and keeps it even if the post is
deleted later; ten clicks at once can't squeeze past the limit (each slot is written first, then counted);
moving an already-booked post to a new time is free; a failed post sent again (Retry, or picking a new
time for it) costs a slot in the week it actually goes out. A slot is given back if the send can't start. Replies work the same way and a failed reply gives its slot back. AI captions are also capped
by the server on total audio (15 one-minute chunks per allowed video per month, re-runs included); a broken
or rejected upload never uses any of it.
Burn-in runs in the browser, so its gate is the app itself (the button asks the server first).
All five are editable per plan in Admin > Pricing (section 05). When a Free member hits one, the app
shows the pop-up "Upgrade to post more" (wording changes per limit) with "See plans" / "Not now".
Billing shows usage meters; the inbox says "N replies left this week" when 3 or fewer remain.

## Beta program (Admin > Beta program, new)
- Switch: beta ON shows the BETA stamp and "Free during beta" wording across the site; OFF removes
  every beta word (hero, pricing, comparison, FAQ, footer, OG image, waitlist page). Defaults to ON.
- First-members offer: set how many members get a code (default 0 = none), which plan and how many
  months (default Creator, 3). Each new member, in join order, is emailed a unique one-time code until
  the seats run out. "Give codes to existing members, oldest first" fills seats from people already
  signed up.
- Codes (BETA-XXXX-XXXX) work once, only on the account they were sent to; redeeming is atomic (two
  clicks at once give one subscription). The plan is free and does not renew (ends after the months).
- "Make a code by hand" for partners/giveaways: works for any account, once, and doesn't use a seat.
- With the switch OFF no codes go out at all: signup, "give codes to existing members" and "make a code"
  are all blocked (codes already sent still work).
- Members redeem under Billing > "Have a beta code?" (case and spaces don't matter). Revoking an unused
  code frees its seat.

## Fixes from the screenshots and checklists
- Landing nav: removed the darker box inside the glass pill and the Dashboard button spilling past the
  pill edge (checked 1440 / 1280 / 1100 / 1024 / 820 / 390 px, dark and light, signed in and out).
- Forgot password on the login page: "Forgot password?" -> emailed 6-digit code -> new password. The
  code only works for reset, once; all other sessions are signed out; 2-step login still applies.
- Contact page now has a real form (creates a support ticket). Spam trap is checked on the server too, and
  one email address can open at most 3 tickets an hour (each ticket emails that address).
- Server error logging (onRequestError + unhandled promise errors), as one line each, with keys, tokens and
  signed-URL parts masked.
- Faster background jobs: goal nudges use one query instead of one per member; weekly reports go out
  5 at a time.
- docs/BACKUPS.md: how to back up and restore the database and media.
- Light-mode contrast fix on the "Save %" yearly badge; admin on/off switches for Beta and Waitlist
  now turn green when on (they were white on white in dark mode).

## Checks
bun test: 502 pass, 0 fail (20 in the new tests/round-1026-plans-beta.test.ts, including the race and
delete-bypass cases). An independent code review (two rounds) was run and every finding fixed. tsc clean. Production build
passes. axe: 0 violations on login/reset, contact, billing (dark + light), upgrade pop-up, admin beta.
