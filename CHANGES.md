# fix-1022e-scroll: section scroll motion back on the landing page (UI only)

Upload AFTER fix-1022d-gsap (and fix-1022-billing-badge; the two do not touch the same file).
One file: copy components/marketing/ScrollScenes.tsx to the same path in the repo, replacing the
1022d version. No schema, API, env or CSS changes.

## What changes
The 1022d pass kept only entrance reveals, so the sections stopped moving with the scroll. This adds
scrubbed section motion back (scene 7 in ScrollScenes.tsx). Every section below the hero moves as it
comes up and is exactly at rest by the time it reaches reading position, so anchor links always land
on a still page.
- Section headings (How it works, Features, Compare, Pricing) drift in behind their content.
- "Publishes to" ticker eases up to full size.
- How it works: the board and rail rise into place (finished before the desktop pin starts).
- Features: the grid rises; on desktop each column settles at its own speed.
- Demo: the player comes forward like a screen (finished before the desktop pin).
- Why Outlly: copy column rises; points slide in from the right on desktop, rise on phones.
- Platforms: head lifts; on desktop the three bento columns move at different speeds.
- Comparison: the table rises (no scale, so the sticky header stays crisp).
- Pricing: middle plan leads, outer two follow; on phones each card rises on its own.
- FAQ: question side rises, answers a beat behind.
- Final CTA: the card swells to full size as it comes up.

## Safety
- Never moves an element the reveal engine, MotionFx or LandingFx already animates (BUSY filter);
  it moves a parent or inner child instead, so transforms compose instead of fighting.
- Created after the pins, so all trigger positions include pin spacing. Ends use clamp() so the
  last sections always reach rest even at the bottom of the page.
- Reduced motion: none of it runs. Phones: about half the travel, no sideways movement.
- Transforms only; no layout properties.

## Verified locally (production build)
- tsc 0; bun test 482 pass (one inbox test timed out under build load, passes on re-run).
- Motion probe, 1440 and 390: all 17 targets moving at section-enter, identity at reading position.
- Audit, 4 viewports: axe 0, overflow 0, small targets 0, ghosts in view 0, console errors 0.
- How pin, demo beats, comparison rows, FAQ tween, /#how deep link: same as 1022d.
