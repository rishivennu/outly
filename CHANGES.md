# fix-1016l-ux (UX round + Phase 1 sending)

Upload every file in this folder to the repo root, keeping the paths. 54 files (plus this note).
Cumulative on top of fix-1016-all: upload fix-1016-all first (or together), then this folder. Where both have a file, this folder wins.
Do NOT upload vercel.json (unchanged), tsconfig.json (local build paths only), .env, or prisma/schema.prisma (generated at build from schema.template.prisma).

## Before it goes live: database
Run `npx prisma db push` against production once (DIRECT_URL). It adds:
- PostTarget.firstComment, firstCommentId, firstCommentError (all optional text, new in this bundle)
- Plan.yearlyMinor (from 10-16k in fix-1016-all, still not pushed)
No data is changed; every new column is optional or has a default.

## What changed

Phase 1: sending feedback (10-16g, never bundled before)
- Sending pill in the studio shell shows posts that are going out, from any page. Tabs stay in sync.
  components/shell/SendingPill.tsx, app/api/posts/sending/route.ts, lib/client/sending.ts, app/(studio)/layout.tsx
- Posting screen: "Notify me when it's live" toggle, "usually takes about N s" hint learned on this device, and a "What happened" summary once a send settles. components/create/PublishingView.tsx
- In-app notice "is live on ..." when a send settles with at least one place live (no email). lib/retention/notices.ts (noticePostLive), lib/retention/core.ts, lib/queue/handlers.ts
- localStorage keys: outlly-sending-ping, plus the sending time samples, notify choice and sent-notice keys in lib/client/sending.ts

1. Bulk scheduling
- New page /create/bulk: add several posts, spread them across days and times, review, schedule in one go. Calendar and Create link to it.
- New route POST /api/posts/bulk.
  lib/schedule/spread.ts, lib/posts/bulk.ts, lib/posts/bulk-server.ts, app/api/posts/bulk/route.ts, components/create/BulkPlanner.tsx, app/(studio)/create/bulk/page.tsx, components/calendar/CalendarView.tsx, components/create/CreateWorkspace.tsx, lib/validation.ts

2. Auto first comment
- Optional first comment per post: posted on Instagram and YouTube once the post is live, sent as a reply on X. A failed comment never fails the post; the reason shows on the posting screen and the post sheet.
  prisma/schema.template.prisma, lib/social/{types,instagram,youtube,x,mock}.ts, lib/queue/jobs.ts, lib/queue/handlers.ts, lib/domain.ts (FIRST_COMMENT_LIMIT, supportsFirstComment), lib/services.ts, app/api/posts/route.ts, app/api/posts/[id]/route.ts, lib/client/first-comment.ts, lib/client/checks.ts, lib/client/device-drafts.ts, components/create/{types,publish}.ts, components/create/CreateWorkspace.tsx, components/create/PlatformDeck.tsx, components/create/PublishingView.tsx, components/posts/PostSheet.tsx
- Accessibility: the platform picker is now a group of toggle buttons (aria-pressed) instead of tabs.

3. Weekly recap
- Monday card on Home: last week's posts, views and best post, can be hidden for the week (cookie outlly_recap_hide). `?recapAt=` preview works in dev only.
  components/home/WeekRecap.tsx, lib/reports/weekly-core.ts, lib/reports/weekly.ts, app/(studio)/home/page.tsx

4. Command palette
- Ctrl K / Cmd K (or the search button in the sidebar and the 44px mobile button) opens a palette: pages, actions and your posts. Optional single-letter shortcuts (N = new post), off inside inputs, toggle saved in localStorage outlly:letter-shortcuts.
- New: GET /api/posts?brief=1 (id, title, status only). Content library opens a post from `?open=<id>`.
  lib/client/commands.ts, components/shell/CommandPalette.tsx, components/shell/PaletteButton.tsx, components/shell/Nav.tsx, app/(studio)/layout.tsx, app/api/posts/route.ts, components/content/ContentLibrary.tsx

5. Delete failed posts
- Trash button on every failed or partly failed card, "Delete all N failed" on the Failed tab, and "Delete this post" on the posting screen. All ask first; if a post went live somewhere the dialog says so. Uses the existing DELETE /api/posts/[id].
- Tab count contrast fix in the content library.
  lib/client/failed-posts.ts, components/content/ContentLibrary.tsx, components/create/PublishingView.tsx

6. Scroll animations on the landing page
- GSAP ScrollTrigger scenes on every section (hero parallax, ticker, route line draw, how it works, features, demo, why, platforms, compare, pricing, FAQ, final CTA). Scrubbed and settle to rest; desktop only (768px+); nothing moves with reduced motion.
  components/marketing/ScrollScenes.tsx, app/(marketing)/page.tsx, components/marketing/bits.tsx (data-route on RouteRule)

## Checks
- bun test: 436 pass, 0 fail (40 files). New: tests/round-1016-{sending,bulk,firstcomment,recap,palette,delfailed}.test.ts
- npx tsc --noEmit: clean
- Browser QA on desktop and mobile: axe 0 new issues, no horizontal overflow, reduced motion respected.

## Still pending in production (unchanged)
Upstash / AI / CRON env vars, cron-job.org pinger, Admin > Update notice Publish, Vercel Functions region syd1 -> bom1.
