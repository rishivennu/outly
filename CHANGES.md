# fix-1016-all (system review "fix all")

Split in two for GitHub's 100-file upload limit. Upload fix-1016-part1 (app/, lib/: 65 files) and then fix-1016-part2 (everything else: 66 files incl. this note) to the repo root, keeping the paths. The build after part 1 alone may fail; it goes green once part 2 lands.
Do NOT upload vercel.json (unchanged) or prisma/schema.prisma (generated at build from schema.template.prisma).

## What changed
- Security/auth: session version claim, "Sign out everywhere" (/api/auth/logout-all), Upstash rate limit, AI daily quota (429 AI_QUOTA), CSP Report-Only header, next 14.2.15 -> 14.2.35.
- Data: Download my data (/api/settings/export), Delete account (/api/settings/account), retention pruning, stuck-post requeue in sweep.
- Time zone: signup stores device time zone, date picker warns when studio and device zones differ.
- UI: mobile nav Home/Create/Calendar/Inbox/More, tour 9 -> 4 stops (after cookie consent), compact cookie bar, chat widget waits for consent, empty analytics state, danger button contrast fix, 96px logo webp, faster hero, no em-dashes in copy, /pricing /faq /features redirect to home sections, unknown guest URLs 404.

- Animated links (Skiper UI skiper40, adapted): new components/ui/animated-link.tsx. Underline draws in on hover and keyboard focus in the footer, nav "Log in", cookie settings and contact cards (with arrow). Inline links in sentences keep their static underline. Attribution comment kept in the file (required by the free license).

- Pip answers every help question inside the chat: "Related" chips and the new "All help questions" list (grouped by topic, from GET /api/support/faq) ask Pip instead of opening /help or /support. A tapped question is answered from that exact FAQ entry (chat API `faqId`), translated for non-English. Related no longer repeats the question just answered. The "delete my account" answer now points to Settings > Your data (one-time migration, admin-edited rows untouched).

- Logo ticker under the hero (components/marketing/LogoTicker.tsx + .lt-* in globals.css): every platform mark and name in one grey, drifting left, faded edges, pauses on hover. Live places first; places without approved keys carry a "soon" tag (follows liveNow(), so a platform loses the tag when its keys go live). Reduced motion: static wrapped row. Shown whenever the hero is on.

- Pip is AI-first: Gemini reads the whole help centre plus a product brief (lib/support/knowledge.ts, built from the site copy and the live platform list), the chat so far, and whether the person is signed in. It answers everyday wording, typos, follow-ups, any language and general creator questions, never invents Outlly facts, and hands money/access problems to a person. Typical reply 1.3 to 1.7 s. Without GEMINI_API_KEY (or if Gemini is down) it falls back to the keyword matcher. Tests force the key off (tests/preload.ts) so they never call the network.

## Prod steps (in order)
1. `bun install` picks up package.json + bun.lock (next 14.2.35).
2. `npx prisma db push` against prod DB (adds User.tokenVersion and AiUsage table).
3. Vercel env (GEMINI_API_KEY is what makes Pip answer properly, set it first): UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, AI_DAILY_LIMIT=60, AI_SUPPORT_DAILY_LIMIT=40, CRON_SECRET, GEMINI_API_KEY, Resend keys.
4. Hobby plan cannot run per-minute crons: set up cron-job.org to call GET /api/cron/sweep every minute with header `Authorization: Bearer <CRON_SECRET>` (see docs/DEPLOYMENT.md).
5. CSP is report-only. Watch the console for a week, then switch to enforcing.

Verified locally: tsc 0 errors, bun test 329/0, axe 0 (light+dark, 1440+390).

## Brand sky (stars + falling comets)
- components/marketing/StarField.tsx (new): fixed, aria-hidden layer behind every public page. 56 twinkling stars, 7 comets falling on a loop (1-2 in flight at once). CSS only, transform/opacity, seeded positions (no hydration mismatch).
- app/(marketing)/layout.tsx: renders <StarField /> inside a .sky-host (isolation) wrapper so the sky sits behind all sections.
- app/globals.css: .sky-* styles. Dark = lime comets with white heads; light = deep green (no lime on white). Reduced motion: comets off, stars static.

## Nav: Product mega menu (inspired by navbar.gallery SaaS menus)
- components/marketing/NavProduct.tsx (new): Product panel with 6 icon tiles (AI captions and hooks, Schedule and publish, Track every destination, Platforms, Compare, Ask Pip) and a lime "See it in 60 seconds" featured card with mini comets. Compact tiles for mobile.
- components/marketing/Nav.tsx: "Features" becomes a "Product" trigger. Opens on hover (180 ms grace) or click, ArrowDown/Tab moves into the panel, Esc closes and returns focus, outside click/focus closes. Compare moved into the panel (still scroll-spied). Mobile menu shows the Product tiles first.
- app/globals.css: .np-* styles, solid card surface, focus-visible rings, reduced motion. Light and dark tested.

## Storage: Cloudflare R2 driver with multipart uploads (lifts the 50 MB cap)
- lib/storage/s3x.ts (new): dependency-light S3/R2 client (SigV4 via aws4fetch): put, head, get, delete, presigned GET/PUT with pinned Content-Length, multipart create/sign part/list/complete/abort.
- lib/storage/index.ts: STORAGE_DRIVER=r2, createDirectUpload() returns tus (Supabase), put (single presigned PUT) or multipart.
- lib/env.ts: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (default outlly-media), R2_ENDPOINT, UPLOAD_PART_MB (10), UPLOAD_PIN_LENGTH (true).
- app/api/media/direct/route.ts: returns the mode-specific upload plan.
- app/api/media/direct/parts/route.ts (new): signs up to 24 part URLs at a time for the owner only, each pinned to its exact size; lists uploaded parts for resume.
- app/api/media/direct/complete/route.ts: verifies every part exists and sizes add up (409 PARTS_MISSING otherwise) before completing, then the existing size + magic-byte checks.
- lib/client/upload.ts: presigned PUT and 4-way parallel multipart with per-part retry, URL re-sign on expiry, resume after reload. TUS path unchanged.
- app/api/cron/storage-copy/route.ts (new): copies existing Supabase files to R2 (Bearer CRON_SECRET, cursor paging).
- tests/helpers/fake-s3.ts + tests/round-1016-r2.test.ts: fake S3 server with an independent SigV4 verifier; 11 new tests. Suite 340 pass / 0 fail.
- docs/DEPLOYMENT.md + README.md: R2 setup, CORS, env table, migration steps.
- After R2 is live: change "50 MB" copy in lib/marketing/content.ts (lines 28, 204, 234) and lib/billing/plans.ts (line 10).

## Fix: drafts not saving / "Your video is still coming in" stuck forever
Root cause: when an upload failed or stalled, Save draft waited forever ("Saving...") and Post always said "still coming in", hiding the real reason. A failed POST /api/posts showed the same message.
- components/create/CreateWorkspace.tsx: save, Post and Connect now wait for an in-flight upload and then continue. A failed upload toasts the real reason, Save draft says "Couldn't save" with how to fix it, Post shows the actual error. Removed the pendingSave path.
- lib/client/upload.ts: 60 s stall watchdog on every upload request (no bytes moving = dropped connection, so retry/resume kicks in instead of hanging). R2 single-PUT resume window capped at 50 min (URL lives 60 min).

## Fix: "Couldn't save the draft. Expected string, received array"
Root cause: Gemini sometimes returns platform hashtags as a JSON array; it was passed straight into the draft, and POST /api/posts rejected it (so no draft, no post).
- lib/ai/creative.ts: generatePlatformCopy coerces every field to text (asText / asTags: "#a #b"), X never gets hashtags; generateHooks coerces hook text/angle the same way.
- lib/validation.ts: target title/caption/description/hashtags accept an array of strings and join it, so an open tab with old state saves too.
- tests/round-1016-copyshape.test.ts: 4 tests. Suite 344 pass / 0 fail.

## New: posting as Live Activity cards (Apple-style), music, galaxy auth/admin/404
- components/create/PublishingView.tsx: one dark card per platform, dot-matrix "YOU -> IG", status box, glowing lime progress bar with the Outlly rocket at the tip, eased progress per stage, Landed / Stopped states, reconnect pills, Pip dancing while it posts, music toggle.
- components/create/VideoStage.tsx: the upload pill is now a mini Live Activity card (Pip, ETA, music, cancel, rocket progress).
- components/create/Groove.tsx + public/audio/pip-groove.mp3: optional background groove while posting/uploading (off by default; toggle). Check the track licence (Pixabay content licence) before launch.
- components/marketing/CometShower.tsx (new) + StarField.tsx: random comets from the top/left edges to the bottom-right across the whole canvas; "space" variant with tinted stars and an emerald nebula. Pauses on hidden tab and reduced motion.
- components/auth/AuthCard.tsx: /login, /signup, /admin/login sit in the galaxy; card edge glow matches the emerald sky.
- components/admin/AdminShell.tsx: admin console gets the star field + nebula.
- components/shared/ErrorScreen.tsx, app/not-found.tsx, app/error.tsx: 404 and error pages in the galaxy, light text on dark in both themes.
- app/globals.css: .la-* (Live Activity), .groove*, galaxy (.sky-space, nebula, tinted stars), .wn-* (update notice), .err-galaxy, cookie banner solid over the sky.

## New: This week on the dashboard
- lib/retention/pulse-core.ts, lib/retention/pulse.ts: views last 7 days with week-on-week change, posts out this week, top post, next good time to post, Mon-Sun strip.
- components/home/SendingNow.tsx: live card for posts that are going out right now (refreshes every 5 s).
- components/home/WeekPulse.tsx; app/(studio)/home/page.tsx wires both in.
- tests/round-1016-pulse.test.ts.

## New: "We made some changes" notice (trust popup)
- lib/updates.ts: notice shape, default copy for this release, shouldShowUpdate (once per published id, skipped for people who joined after it), cleanItems.
- components/shell/WhatsNew.tsx: modal shown once per member on the dashboard, after the cookie banner, never on the same visit as the guided tour or welcome offer. "Tell us what's off" opens Help with the message form ready; "Got it" closes. Radix focus trap, Esc, 44 px buttons, reduced motion.
- app/(studio)/layout.tsx mounts it; lib/settings.ts adds the "updates" config (stored in the Setting table, no schema change).
- Admin > Setup > Update notice (app/admin/(panel)/updates/page.tsx, components/admin/UpdatesEditor.tsx, app/api/admin/updates/route.ts, nav entry in AdminShell): edit title, note and changes with live preview; "Publish to members" shows it again to everyone; "Save quietly" fixes typos; on/off switch.
- components/support/HelpCenter.tsx: /support?write=changes opens the form with "About the recent changes: " and focuses it. Messages land in Tickets.
- tests/round-1016-updates.test.ts.
- After deploying, press Publish once in Admin > Update notice so the date matches the deploy.

## New (10-16e): stop uploads, live cards, drafts on device, speed
- Stop uploads: "Stop this upload" on each card and "Stop all uploads" (with a confirm) on the publishing screen. Works while a target is pending, queued or uploading; once the platform has it ("Going public now") it can't be stopped. A stopped target shows "Stopped by you" and can be sent again.
  - lib/domain.ts (CANCELED error code, STOPPABLE), lib/services.ts cancelTargets, new app/api/targets/[id]/cancel/route.ts and app/api/posts/[id]/cancel/route.ts, lib/queue/handlers.ts (every step re-checks for a stop; a stop during the upload means it is never published).
- Publishing screen redesign (components/create/PublishingView.tsx, .lv-* in globals.css): glass cards side by side (1 per row on phones, up to 4 on wide screens), a single card sits in the middle, original platform logos, a glow in the state colour (violet waiting, lime sending, green live, red needs a hand, grey stopped). components/shared/PlatformIcon.tsx: square logo tiles.
- Music: off the creation screens (VideoStage), kept on the publishing screen. Groove.tsx primeGroove() unlocks audio inside the Launch click.
- Destination rail on step 3 (components/create/PlatformDeck.tsx, .deck-* CSS): arrows, faded edges, mouse-wheel scroll, active tab scrolled into view.
- Drafts on this device: lib/client/device-drafts.ts keeps each draft in the browser (IndexedDB, video included, newest 8). components/create/DeviceDrafts.tsx lists them on an empty Create page and on Content > Drafts with "Pick it up" (re-uploads the video) and Remove. /create?post= for an expired draft brings it back from the device. Removed from the device once launched or scheduled.
- Drafts left untouched for 3 days are deleted from Outlly (lib/retention/prune.ts pruneStaleDrafts, run by the daily /api/cron/retention), with their video when no other post uses it. Drafts booked for a future time or waiting on a reviewer are kept. Copy in SaveDraft and the Drafts tab says so.
- Speed: home page queries run in one parallel batch; sidebar links prefetch on hover instead of all at once (components/shell/HoverLink.tsx, Nav.tsx); the notices bell no longer fetches twice (NoticesBell.tsx). app/(studio)/create/page.tsx passes ?local= and missing ?post=.
- Tests: tests/publishing.test.ts "stopping uploads" (5), tests/round-1016-backend.test.ts "draft expiry". Full suite 359 pass.
- Biggest remaining speed win is a setting, not code: put Vercel Functions in bom1 (Mumbai) in Project Settings > Functions, and keep the database in or near the same region. Today functions run in syd1 while visitors arrive at bom1, so every request crosses regions.

- Review fixes (10-16e): a stale publish job can no longer re-post something already live; stopping works only while a post is sending (a booked post is called off with Unschedule, so one Stop can't strand the rest); quieter screen-reader updates on the publishing screen; polling slows after 2 minutes and stops if signed out; a restored draft's video is not rewritten to the browser again; old drafts are deleted in batches. Tests 361 pass.

- Posting screen + demo (10-16f): the posting screen shows one Live Activity card per place (dot-matrix YOU -> IG route, status box, rocket track), two per row on wider screens, one on phones (components/create/PublishingView.tsx). The dot-matrix letters moved to components/brand/DotText.tsx (new). The home page demo (components/marketing/DemoFlow.tsx) is now three tiles (One upload, Three drafts, the lime step tile) plus the same Live Activity cards for Instagram, YouTube and X, driven by the demo steps; X shows the failure and the retry. Removed the Three sends, Its own status, Fix just the one and Live right now tiles, which repeated the cards. Demo cards and tiles have a light variation in light mode and stay ink glass in dark; the cards wrap to fit any width (3, 2+1, or stacked). app/globals.css: .bx-gc / .gc-* glow tiles, .la-themed light variants. Contrast measured on the rendered pixels: every label 4.8:1 or better in light, 5.4:1 or better in dark. axe 0, tsc 0, tests 361 pass.
