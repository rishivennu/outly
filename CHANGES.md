# fix-1015-features (33 files + this note)

Upload AFTER fix-1014-perf. Drop the contents at the REPO ROOT (paths are relative to it).

## What's in it
1. Admin > User behavior (/admin/behavior). Breakdown tab: actives, stickiness, activation funnel, retention, weekly cohorts, segments, frequency, weekday rhythm, platforms, posting habits, paid vs free, most engaged. Gemini analyses tab: run an analysis (optional focus question), every version is saved and numbered, older versions load on demand, each version lists what changed since the previous one, "Copy as text". Gemini only sees anonymised totals.
2. Save draft on every create step, with an autosave line and a "View drafts" link (/content?filter=draft).
3. Publish only to chosen platforms: each destination has a Sending / Skipping checkbox; the server only creates targets for the kept platforms.
4. First-time greeting on /home for new free users, inviting them to subscribe (waits for the tour, shows once).
5. Email template redesign: Bricolage Grotesque + DM Sans, dark header, lime button, full footer.
6. GSAP motion (gsap + @gsap/react): breakdown cards stagger in, numbers count up, bars grow, cohort grid fills; analysis versions reveal section by section; the greeting choreographs its copy, offer and check marks. Reduced-motion users get the final state with no tweening.

## Deploy notes
- New dependencies: gsap, @gsap/react (package.json + bun.lock included).
- New table BehaviorAnalysis: the build's db sync creates it on Vercel; otherwise run `prisma db push` once.
- Set GEMINI_API_KEY for the analyses tab (without it the tab explains what to set).

## Auth redesign (sign in / sign up)
- New split card: brand light panel on the left (lime, deep green, cream, ink; GSAP drift, pointer lean, glides between the two routes), form on the right.
- Form: mark, title, labelled fields, lime action, then "or continue with" Google (always shown; needs YouTube OAuth keys or it returns ?google_error=not_configured).
- Signup fits the screen with no scroll down to 1280x720 and on 390px phones. Skeleton fallback so the form area is never blank while code loads.
- Files: app/(auth)/{layout,template}.tsx, app/(auth)/{login,signup}/page.tsx, components/auth/{AuthForm,AuthShowcase,AuthFormSkeleton,GoogleButton}.tsx, app/globals.css.

## Verifier fixes
- lib/admin/behavior.ts: stored health value is whitelisted (a bad value used to crash /admin/behavior).
- components/admin/BehaviorAnalyses.tsx: safe health lookup, no hydration warning on "x min ago".
