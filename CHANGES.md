# fix-1018b-motion

Cumulative on fix-1018-security-upi. Upload fix-1018 first, then these 14 files (same paths). NOT live.

## Motion
- LandingFx.tsx (new): pauses animations in off-screen sections; magnetic CTAs; card spotlight; hero aura that follows the pointer; ticker speeds up/reverses with scroll speed.
- ScrollScenes.tsx: built when the browser is idle; hero card fan deals out on scroll; #why slide-in is horizontal only on desktop (tablet overflow fix).
- globals.css: motion layer at the end of the file, off for reduced motion and touch.

## UX fixes
- Tablet 768 horizontal overflow (806 -> 768).
- Tap targets under 44px: 22-25 -> 0 (footer links, currency select, chat nudge, compact theme toggle, bento dots, hero pill).
- Looping animations while off screen: ~145 -> ~75.

Checks: tsc 0, 482 tests pass, next build OK, axe 0, console errors 0, CLS <= 0.022.
