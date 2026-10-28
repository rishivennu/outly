# fix-1035-landing (10-28)

Upload AFTER fix-1033-csp-ux and fix-1034-tour. Three files here also appear in those bundles, and the copies here
already contain those changes, so these must be uploaded last:
- app/(marketing)/page.tsx and app/globals.css (also in 1033)
- components/support/ChatWidget.tsx (also in 1034)

No database change. No new environment variable: /api/try uses the existing GEMINI_API_KEY (and Upstash for limits
when it is set). Without a key it still answers, from the built-in offline writer.

## Try it section (new)
- components/marketing/TryIt.tsx: the "One line in. Three posts out." section, placed after the logo ticker.
- components/marketing/TryItStage.tsx: input, three sample chips, three cards (Instagram caption, Shorts title,
  X post) with character counts. Typed lines go to /api/try. The sample chips answer instantly from drafts the
  real engine wrote once. If the writer is slow, down or rate-limited, a local template fills the cards and a
  note says so. "Keep these drafts" goes to /signup?next=/create?text=<topic>, so the topic is waiting in Create.
- app/api/try/route.ts: public POST. Same-origin check, 8 a minute per IP, 30 a day per IP, topic 2 to 80
  characters with control and bidi characters removed, bodies over 2 KB refused (413). 504 after 12 s.
- lib/try.ts: hook first, then captions on it (the studio's own engine), each draft clamped to its limit,
  successful model answers cached in memory (300 topics). One model with 5 s + 6 s timeouts, so a slow model
  is cut off inside the 12 s budget instead of billing after a 504. Double quotes and backticks are neutralised
  so a topic can't break out of the prompt.
- lib/ai/creative.ts: generateHooks and generatePlatformCopy take an optional last `opts` (timeout, models).
  Every existing caller is unchanged.
- components/marketing/SignupCta.tsx: optional `next` prop (waitlist mode still goes to /waitlist).
- tests/try.test.ts: cleaning, clamping, engine-to-card mapping, offline answer, time budget.
- app/globals.css: .try-* styles appended at the end.

## Landing audit fixes
- page.tsx, Hero.tsx: honest platform list from liveNow() ("4 more coming soon").
- ChatWidget.tsx: the Pip "Questions?" nudge waits 15 s and leaves after 9 s.
- globals.css: 2px lime scroll frame.
- Comparison, Demo, Difference, Faq, Features, HowItWorks, Platforms, Pricing: section spacing py-16 sm:py-20.
- FinalCta.tsx, FinalCtaButtons.tsx: lime final CTA pill.

## Checked locally
tsc 0 · bun test 801 pass · next build 0 · CSP smoke 21/21 · axe clean at 1440 and 390 · no targets under 44px ·
reduced motion shows full text · live Gemini answers in 3.4 to 4.1 s · no Origin = 403 · 1 character = 400 ·
9th call in a minute = 429 · 5 KB body = 413.

## After deploy
Type a topic on the landing page and check the three cards fill. Then rotate GEMINI_API_KEY (still open).
