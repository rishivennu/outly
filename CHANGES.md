# fix-1016-all (system review "fix all")

Upload every file in this folder to the repo root, keeping the paths. 75 files.
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
