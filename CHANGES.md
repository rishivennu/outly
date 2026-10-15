# fix-1015-brand (2026-10-15)

Upload AFTER fix-1015-home (order: fix-1014-perf, fix-1015-features, fix-1015-retention, fix-1015-home, fix-1015-brand).
Copy every file to the SAME path at the REPO ROOT (for example `app/globals.css` goes to `<repo>/app/globals.css`).
No database, env or package changes.

## Home bento (Platforms + Demo)
- `components/marketing/bento/Art.tsx` (new): small animated art pieces for tiles (bars, rings, avatars, bolt, graph, arrow).
- `components/marketing/bento/LimeCta.tsx` (new): the whole lime tile is one link to /signup (or /waitlist when the waitlist is on).
- `Platforms.tsx`: rebuilt as a 3-column bento with a small animation in every tile.
- `DemoFlow.tsx` + `Demo.tsx`: demo steps live in the bento; steps auto-play every 2.5s with a Pause/Play button, keyboard tabs (arrows, Home, End).
- All motion stops under reduced motion.

## Whole-page glow
- `app/globals.css`: soft corner glows behind every page (lime bottom-right, indigo bottom-left, faint top), lighter in light mode. Turned off for high contrast, forced colours and print.

## Posting animation
- `components/create/PostingAnimation.tsx` (new): soft grainy ribbons flowing into a glass pill "Posting to {place}" that cycles through each place still sending, with Pip flying above. Decorative (aria-hidden); still under reduced motion.
- `components/create/PublishingView.tsx`: shows it while a post is going out.

## Admin login restyle
- `components/auth/AuthCard.tsx` (new): the floating sign-in card, shared.
- `app/(auth)/layout.tsx`: now uses AuthCard.
- `components/auth/AuthShowcase.tsx`: takes eyebrow/lines, adds an admin pose.
- `app/admin/login/page.tsx` + `components/admin/LoginForm.tsx`: admin login now matches sign-up (same card, fields, lime button, shake on wrong password). Login logic unchanged.

Checks: tsc 0 errors; axe 0 violations and no sideways scroll on home, signup, admin login and the posting view, light + dark, 1440 / 800 / 390.
