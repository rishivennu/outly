# fix-1014-speed (cumulative: includes everything in fix-1014-play)

Copy each file over the same path in the repo. 19 files, listed in FILES.txt (FooterWordmark.tsx is NEW).

1. Localhost speed (next.config.mjs): `compress` is now production only. The dev server was gzipping
   ~10 MB of unminified JS on one thread every page load (main-app.js alone took 6.6 s). Warm page:
   DOMContentLoaded 11.5 s -> 2.9 s. Vercel / `next start` still compress as before.
2. Hero fan (HeroFan.tsx `framed`, Hero.tsx, globals.css `.hf-stage.hf-framed`): the landing is back to the
   original boxed stage (hard sides, 64px fade into the page). Dashboard home keeps the soft mask.
   Fan bottom fade restored to the pre-Play values.
3. Dotted rule under the hero (app/(marketing)/page.tsx): same 1180px box as the fan stage, so both edges line up.
4. Footer wordmark (Footer.tsx, NEW FooterWordmark.tsx, globals.css `.footer-card` / `.footer-word` / `.fw-svg`):
   - The word is now an inline SVG built from the site's own Bricolage Grotesque (bold, same shapes as before), so it
     can be drawn like a pen. Tighter tracking: -0.05em.
   - Fills the card: ink exactly 40px from each edge, centred, the "y" tail sits on the bottom line (measured at
     1440/1024/390px).
   - Signature loop (not scroll): a pen draws each letter's outline one after another, the ink fades in behind it
     (the "o" keeps its hole), the word holds, then the ink lifts and the line runs off in the writing direction.
     11s cycle, sine ease in-out, 60fps with no long frames. Paused while the footer is off screen
     (IntersectionObserver). Reduced motion = static filled word.
   - Card is `overflow-clip` (was overflow-hidden, which made it a scroll container).
5. Nav (globals.css `.mnav-bar`): liquid glass (tinted pane, blur + saturation, specular top, white refracted rim),
   no coloured glow. Reduced-transparency users get a solid bar.
6. Scroll progress (components/shared/ScrollProgress.tsx, app/layout.tsx): glowing lime line down the RIGHT edge of
   every page. CSS scroll-driven where supported, rAF fallback elsewhere; hidden on pages that don't scroll.
