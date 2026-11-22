import s from "./hero.module.css";

/**
 * The hero's art layers, each a separate transparent element so the scroll timeline in Hero.tsx can move them
 * independently: the halo (far plane), the stone, then both hands inside one `clasp` wrapper (R1302: the wrapper
 * takes the handshake, the hands take the approach and the pointer parallax, so no two tweens share a transform)
 * and the lime burst that flashes where the palms meet. The hands and the stone are extracted from the reference
 * design (public/partners, halftone re-rasterised as crisp SVG dots, the stone re-coloured to the brand lime); the
 * clasped handshake (R1302, from the user's reference photo, same dot style: grey for the robot side, skin for the
 * creator's) is the pose the open hands cross-fade into at contact. All loaded as images so their dots never touch
 * the DOM. Decorative only.
 */
export function HeroArt() {
  return (
    <div className={s.art} aria-hidden="true">
      <div data-hero="halo" className={s.halo} />
      <div data-hero="orb" className={s.orb}>
        <span className={s.glow} />
        <img className={s.stone} src="/partners/object.webp" alt="" width={480} height={576} decoding="async" fetchPriority="high" />
        <span className={s.reflect} />
      </div>
      <div data-hero="clasp" className={s.clasp}>
        {/* eslint-disable-next-line @next/next/no-img-element -- static halftone art, an optimiser round trip adds nothing */}
        <img data-hero="left" className={`${s.hand} ${s.handLeft}`} src="/partners/hand-robot.svg" alt="" width={1104} height={936} decoding="async" fetchPriority="high" />
        {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
        <img data-hero="right" className={`${s.hand} ${s.handRight}`} src="/partners/hand-human.svg" alt="" width={1000} height={776} decoding="async" fetchPriority="high" />
        {/* eslint-disable-next-line @next/next/no-img-element -- see above; needed only once the scroll reaches the clasp */}
        <img data-hero="shake" className={s.shake} src="/partners/handshake.svg" alt="" width={1362} height={894} decoding="async" />
      </div>
      <div data-hero="burst" className={s.burst} />
    </div>
  );
}
