# fix-1022d-gsap: GSAP cinematic pass (UI only)

Upload AFTER fix-1022c-no-watermark. Cumulative on it: app/globals.css here already contains the
watermark removal. Copy each file to the same path in the repo, replacing the old one. No schema,
API or env changes.

## What changes
- One reveal engine (NEW lib/motion/reveal.ts) replaces the old CSS-transition reveals and the
  per-section scroll parallax. ScrollTrigger.batch groups what enters view together into one
  staggered wave. Choreographies via <Reveal fx>: rise, stagger, cards (pricing, centre plan first),
  tiles (bento tiles in reading order), rows (comparison groups, rows in threes), footer.
- Hero: a soft light sweep (CSS mask) crosses the headline as the words unfold. The headline never
  goes to opacity 0, so LCP is not delayed. The dashboard home hero gets it too.
- How it works (desktop, when it fits the screen): the section pins; a lime rail fills step by step,
  nodes light, steps 2 and 3 brighten as they arrive.
- Demo (desktop): scroll walks the four beats (the beat clock pauses while you scroll through).
- Comparison: opening a group brings its rows in by threes.
- FAQ: answers open/close with a real-height GSAP tween; reversing mid-motion is smooth.
- Final CTA: walls slide in, phone rises, tiles stagger from the edges.
- Dashboard (studio) and admin: on navigation, the page's top-level blocks settle in one after
  another (admin shorter and lower).

## Safety
- Reduced motion: no pins, no movement, short fades only. Phones: no pins, short lift + fade.
- Content is hidden only under html.js; if the engine never runs, a CSS failsafe shows everything after 3s.
- CSS transitions are suspended during each tween so hover transitions never fight the entrance.

## Verified locally (production build)
- tsc 0, bun test 482 pass / 0 fail.
- audit: 4 viewports, axe 0, no overflow, no stuck-hidden content, 0 small tap targets,
  0 infinite animations under reduced motion, frame p50 10-13 ms.
- Motion checks: hero mask present then removed, how pin + rail + nodes, demo beats via scroll,
  rows-in on group open, FAQ height tween, failsafe, no pins on phone / short screens / reduced motion,
  studio and admin page stagger settle fully, 0 console errors.
