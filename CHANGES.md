# fix-1022e-scroll: section scroll motion back on the landing page (UI only)

Upload AFTER fix-1022d-gsap (and fix-1022-billing-badge; the two do not touch the same file).
Two files: copy components/marketing/ScrollScenes.tsx and components/marketing/SmoothScroll.tsx to the
same paths in the repo, replacing the old ones. No schema, API, env or CSS changes.

## What changes
The 1022d pass kept only entrance reveals, so the sections stopped moving with the scroll. This adds
section motion back (scene 7 in ScrollScenes.tsx). Every section below the hero settles into place
as it comes up. It is TIME-BASED, not tied to the scrollbar: each scene starts when its section comes
into view and always plays at the same calm pace (1.6s desktop, 1.1s phones, soft power2.out ease),
however fast the visitor scrolls. Once per visit.
- Page scroll is calmer on desktop (SmoothScroll.tsx, Lenis): each wheel notch moves 20% less
  (wheelMultiplier 1 -> 0.8) and the glide is softer (lerp 0.1 -> 0.075). Touch scrolling is native
  and unchanged.
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
- Created after the pins, so all trigger positions include pin spacing. Each scene owns its trigger,
  so a section already in view or scrolled past while the page loads still plays (never stuck offset).
- Reduced motion: none of it runs. Phones: about half the travel, no sideways movement.
- Transforms only; no layout properties.

## Verified locally (production build)
- tsc 0; bun test 482 pass (one inbox test timed out under build load, passes on re-run).
- Speed probe: after an instant jump (fastest possible scroll) sections still take the full ~1.5s
  (desktop) / ~1s (phone) to settle. Load-race probe: jumping mid-load, the section in view and all
  above it settle; sections below wait for their turn.
- Audit, 4 viewports: axe 0, overflow 0, small targets 0, ghosts in view 0, console errors 0.
- How pin, demo beats, comparison rows, FAQ tween, /#how deep link: same as 1022d.
