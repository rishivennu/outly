# Competitor research — Buffer, Metricool, Later, Hootsuite

Backing notes for `lib/marketing/comparison.ts`, which drives the comparison table on the landing page.

**Compiled:** 2026-10-10
**Method:** `web_search` (public) to locate each company's own pages, then `web_fetch` of the
official pricing / feature pages listed below. Only first-party pages were used for cells.
Third-party reviews and roundups were read for orientation and are **not** cited as evidence.

## Rules applied to every cell

| Value | Means |
|---|---|
| `yes` | Stated on the competitor's own page. |
| `partial` | Available, but gated behind an add-on, a higher tier, or a metered credit allowance. |
| `no` | The competitor's own page shows it is not offered (e.g. a platform absent from their supported list). |
| `unknown` | Not confirmable from their public pages. **Not** evidence of absence. |

No row is marked exclusive to Outlly. Where we could not verify a competitor's behaviour —
notably per-destination publish status and single-destination retry — the cell is `unknown`
for all four, not `no`.

Rows where Outlly is honestly behind are included on purpose: unified inbox (`no`), team
approval workflows (`no`), networks beyond Reels / Shorts / X (`no`), analytics (`partial`).

---

## Buffer

Sources fetched 2026-10-10:
- <https://buffer.com/pricing>
- <https://buffer.com/ai-assistant>

Evidence used:
- **Plans:** Free (3 channels, 10 scheduled posts per channel, 30-day Insights history, AI Assistant
  included), Essentials $5/channel/month, Team $10/channel/month. Pricing page states pricing was
  last updated November 2025. Per-channel billing with volume discounts above 10 channels.
- **Supported-channel table** lists *Automatic Publishing* for Instagram business and creator
  accounts, `YouTube (Shorts)`, and X/Twitter free and premium profiles. Instagram personal
  profiles are notification-publishing only.
- **AI Assistant** is on every plan with "unlimited credits"; the AI Assistant page describes
  "smart repurposing — turn a single post into multiple formats and styles tailored to each social
  media platform" and content tailoring per channel. This is what supports the `yes` on
  per-platform variants.
- **Calendar:** "Visual content calendar" included on all plans.
- **Media library:** not listed. The pricing page documents imports from Google Drive/Photos,
  Dropbox, OneDrive, Canva and Unsplash, plus an Ideas store with tags and board view — hence
  `partial`, not `yes` or `no`.
- **Community inbox** with AI replies on all plans; approval workflows on the Team plan only.
- Other networks listed: Facebook pages and groups, LinkedIn pages and profiles, TikTok business,
  Pinterest, Threads, Bluesky, Mastodon, Google Business Profile.

## Metricool

Sources fetched 2026-10-10:
- <https://metricool.com/pricing/> (the pricing page is heavily client-rendered; the plan-limit
  wording quoted below was surfaced by `web_search` from that same URL)
- <https://metricool.com/analyze-youtube-with-metricool/>

Evidence used:
- **Free plan:** "Manage all your brands' social networks (except LinkedIn and Twitter)", limited
  scheduled posts per month, 30 days of analytics, AI social media assistant included. This is
  what supports `partial` on X: X is reachable, but via the paid **X add-on** ("Access to the X
  add-on" is listed as a paid-plan line).
- **YouTube:** their YouTube page states you can "analyze your channel, schedule Shorts and videos".
- **Per-platform variants:** planner step 3 on the same page — "Repurpose content across all
  platforms: publish the same video optimized for Shorts, Reels and TikTok in one click".
- **AI:** "Get AI-powered content ideas when creativity takes a break" (planner step 4) and the
  AI social media assistant in the plan list.
- **Analytics / reporting:** the core of the product, including automated reports and competitor
  benchmarking, available on the free plan.
- **Inbox:** "All your messages and comments, neatly in one place" (home page).
- **Media library / approvals:** not described on the pages checked → `unknown`.
- Other networks named across their pages: LinkedIn, Facebook, TikTok, Pinterest, Threads,
  Bluesky, Google Business Profile.

## Later

Source fetched 2026-10-10:
- <https://later.com/pricing/>

Evidence used:
- **Supported platforms, verbatim:** "Later supports Instagram, Facebook, TikTok, Threads, YouTube,
  Pinterest, LinkedIn and Snapchat." **X is not in that list**, which is the only `no` in the
  table drawn from an explicit platform list rather than an absence of evidence.
- **Scheduling row** names Instagram posts/Stories/Reels, Facebook posts and Reels, TikTok, Threads,
  Pinterest Pins, **YouTube Shorts**, LinkedIn, Snapchat Spotlight and Stories.
- **Plans:** Starter / Growth / Scale. No free tier is offered on the pricing page → `no`.
- **AI:** "AI credits are used to power Later's AI features: Ideas and Caption Writer. 1 credit
  generates 3 ideas or 1 caption." 5 credits/month on Starter, 50 on Growth, 100 on Scale → `partial`.
- **Media library:** "Upload and store unlimited photos and videos in your Media Library. Maximum
  file sizes 20MB/photo & 512MB/video" → `yes`.
- **Calendar:** drag-and-drop visual calendar across all platforms, all plans.
- **Analytics:** per-platform insights on all plans, but cross-profile "Custom Analytics" with
  filters and shareable reports is Scale-only → `partial`.
- **Collaboration:** submit-and-approve plus external reviewer links on Growth and Scale → `partial`.
- **Per-platform text variants:** the page documents scheduling one post to multiple profiles and
  saving captions, but not per-profile text variants → `unknown`.

## Hootsuite

Sources fetched 2026-10-10:
- <https://www.hootsuite.com/plans>
- <https://www.hootsuite.com/platform/integrations>
- <https://www.hootsuite.com/platform/publish>

Evidence used:
- **Plans:** Standard (10 social accounts), Professional (unlimited accounts), Advanced (approvals
  and team collaboration), Enterprise (custom). Per-user-seat pricing; the FAQ states paid plans
  start at $99 Standard, $199 Professional, up to $399 Advanced. 14-day trial, no credit card,
  **no free tier** → `no` on free plan.
- **Supported networks, verbatim:** "We support Facebook, Instagram, X (Twitter), LinkedIn, TikTok,
  YouTube, Threads, WhatsApp, and Pinterest."
- **Instagram:** "create, schedule, and post Instagram feed posts, carousels, and Reels"; a
  Business account is required for certain features.
- **X:** "You can use Hootsuite to post and schedule Tweets."
- **YouTube:** videos and Shorts can be published or scheduled to a channel (their help centre
  article `publish-yt`, linked from the integrations page; the help centre itself returned 401 to
  our fetch, so the claim rests on the integrations and YouTube product pages).
- **AI:** plans page — "Generate posts and images with AI" on every plan, under the "Wisdom" brand.
- **Approvals:** "Review and approve content with your team" starts on Advanced → `partial`.
- **Inbox:** "Respond to messages from one inbox" on every plan.
- **Media library / per-network text variants:** not described on the pages checked → `unknown`.

---

## Known gaps in this research

1. `help.hootsuite.com` and `help.metricool.com` both refused our fetches (401 / blocked), so
   help-centre detail was not used as evidence. Anything only documented there is `unknown`.
2. The Metricool pricing page is client-rendered; plan-limit wording came from a search index of
   that same URL rather than the fetched HTML. Re-verify in a browser before quoting prices.
3. Prices move. Buffer's page says its pricing last changed in November 2025; Metricool had a
   price change in 2026 per third-party trackers. The comparison table deliberately contains **no
   competitor prices** for this reason — only capability rows.
4. Per-destination retry semantics are genuinely hard to verify from marketing pages. If this
   becomes a load-bearing claim, it needs hands-on accounts, not more reading.

## Re-verification

When updating, change `lastVerified` per competitor in `lib/marketing/comparison.ts` and update
this file in the same commit. The landing page prints the date from that file, so a stale table
advertises its own staleness.
