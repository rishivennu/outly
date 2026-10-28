# fix-1037-pro-manager (10-28): Pro Multi-Account Manager plan + landing extras

Upload LAST, after 1033 -> 1034 -> 1035 -> 1036. 97 files + this note.
Files that are also in earlier bundles (this copy is the newest, so it must go up after them):
- 1033: app/(marketing)/page.tsx, components/create/BulkPlanner.tsx, components/shell/Nav.tsx
- 1034: app/(studio)/layout.tsx, components/onboarding/Spotlight.tsx, components/onboarding/Tour.tsx,
  components/settings/AccountsView.tsx, components/settings/SettingsView.tsx, components/shell/Nav.tsx
- 1035: app/(marketing)/page.tsx, components/marketing/Pricing.tsx, lib/landing.ts
- 1036: app/(studio)/billing/page.tsx, app/(studio)/home/page.tsx, components/billing/BillingView.tsx, prisma/schema.prisma

## Before / after deploy
1. Run `npx prisma db push` against production (after 1036's push, or once for both). All additions are
   nullable or defaulted, so it is safe on live data:
   - User: lastSeenAt (indexed), alertPrefs
   - Plan: accountLimit (default 0 = old rule, one account per platform)
   - TeamMember: accountIds (null = every account, as before)
   - Post: editedAt, editedBy, editedById
   - ReviewRequest: createdById (who made a review link; null = the owner)
   - New model PostNote (team comments on a draft)
2. The plan appears by itself: the first pricing read adds "Pro Multi-Account Manager" once
   (Rs 2,499/mo, USD 29, 10 accounts, 5 seats). If a plan with slug pro-manager already exists it is left
   alone. Edit price, name or account limit in Admin > Pricing (new "Connected accounts" field on every plan).
3. Cron: /api/cron/retention now also runs the engagement-spike sweep and returns a new `spikes` count.
   The cron-job.org pinger needs no change. Without cron, the sweep runs at most once an hour on traffic.

## What it does
- Plan: up to 10 connected accounts (several per platform) under one login. The founding-member price
  (1036, default 30% for life) applies to this plan at checkout like any other.
- Home profile switcher: every linked profile with avatar, name, platform icon and online dot; search and a
  platform filter; the active profile is highlighted. One tap switches without a page reload, and the pick
  is kept in a cookie (survives reloads and tabs). Content, Calendar, Approvals and Analytics then show only
  that account. "All profiles" goes back to everything combined.
- Bulk: schedule up to 10 videos across up to 10 selected accounts in one go. Two accounts on the same
  platform become separate posts of the same video (one round per extra account), each with its own status.
- Analytics: combined view with a "By account" list; tap one to drill in. PDF and CSV client reports for the
  whole workspace or one account (/api/reports).
- Team: per-account access for each assistant (Settings > Team > accounts picker). A member only ever sees
  and acts on their accounts: pages, APIs, reports and bulk all re-check it, and a bad value fails closed.
- Draft collaboration: team notes on each draft, approve before publish; an edit after an approval needs a
  new approval, and nobody approves their own change.
- Alerts (Settings > Alerts, owner only): failed scheduled post (on), engagement spike (on, 2x a normal day,
  choose 1.5x / 2x / 3x / 5x), optional spike email. Days under 100 views never count; at most one spike
  alert per account per day. Reconnect alerts always stay on.
- Trust badges: Founding Member and Verified Manager (pro-manager plan + confirmed email + 2 or more accounts)
  on Billing.
- Live counts: "N creators on Outlly · N online now" in the sidebar, mobile top bar and landing footer.
  Hidden until there are at least 10 creators and 2 online, so small numbers are never shown or padded.
- Footer: Google Play and App Store badges marked "Coming soon" (not links).
- Landing: "Time saved" calculator (the visitor's own numbers, working shown), "Trust" section with real
  figures (each hidden until it is big enough: 50 creators, 100 posts) and five true safety facts. Both can
  be switched off in Admin > Landing like the other sections.
- Onboarding tour: a "What you get" stop listing the benefits.
- Checkout note: Razorpay already opens in-page as an overlay. Stripe would need Stripe Elements to do the
  same; today it redirects to Stripe's hosted page.

## Scalability notes
- Indexes: User.lastSeenAt for online counts; TargetMetric(targetId, capturedAt) for analytics and spikes.
- Spike sweep: one groupBy per window over metric rows, account ids in chunks of 500, hourly at most.
- Presence: each person writes lastSeenAt at most once a minute (in-memory throttle, updateMany);
  the public counts are cached 30 s and the browser polls every 60 s only while the tab is visible.
- Trust figures cached 10 min; plans cached 10 s.
- Scope lists capped at 50 ids; bulk capped at 10 videos x 10 accounts per request.
- Analytics loads metric rows once per request and derives totals, per-platform and per-account from them.

## Known behaviour
- After a downgrade, accounts above the new limit stay connected; the limit is enforced on the next connect.

## Hardening after independent review (1037b)
- Comments inbox and Messages now follow a member's account scope: list, open, reply and sync only touch their
  accounts; any other account gets the same 404 as a missing one (lib/inbox.ts, lib/messages/service.ts and routes).
- An editor can't book a failed or partly-sent post again through PATCH /api/posts/[id] (that is a launch): 403.
- A review link remembers which team member made it. Its approval doesn't clear a change that same member made,
  so nobody approves their own edit by opening their own link. Links made by the owner work as before.
- Engagement-spike sweep walks accounts in pages of 500, skips practice accounts and owners with spikes off first,
  and only reads metric rows for that page (no table-wide scan).
- One-account plans (including a lapsed Pro owner) no longer delete the other account on a platform when a new one
  connects: it is set aside as disconnected with its tokens wiped, its posts keep their link, and reconnecting
  brings it back.
- The account-limit count and the write run in one serializable transaction (two connects at once can't both win).
- /api/stats/live is rate limited per IP (30 a minute); the bulk precheck uses the member's own account per platform.

## Checks
tsc 0 | bun test 852 pass 0 fail (31 in tests/round-1037-pro.test.ts) | next build 0 | CSP smoke 21/21 |
axe clean (desktop + mobile) on home switcher, content, calendar, analytics drilldown, accounts, settings
alerts, billing, landing, admin pricing. Delegation checked live as a scoped assistant (forbidden profile 404,
forged drill falls back to own accounts, report limited to own accounts, alerts change 403).
Review findings re-run live as the scoped editor after the fixes: inbox and messages show no other account,
reply as another account 404, editor rebooking a failed post 403, live counts 429 past the limit.
