"use client";
import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { ArrowRight, Globe, Instagram, Music2, Twitter, Youtube } from "lucide-react";
import { MOTION_OK } from "@/lib/motion/prefs";
import { HeroArt } from "./HeroArt";
import s from "./hero.module.css";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const REDUCED = "(prefers-reduced-motion: reduce)";
const END = {
  left: { xPercent: 4, yPercent: 6, scale: 0.8 },
  right: { xPercent: -4, yPercent: 6, scale: 0.8 },
  orb: { yPercent: -12, scale: 0.7, rotation: 14 },
};

/**
 * R1282 /partners hero. The section is taller than the screen and its stage is CSS-sticky (no pin spacer under Lenis,
 * which already drives the window scroll that ScrollTrigger reads). One scrubbed timeline over the section's own
 * scroll: the hands close in and shrink, the stone shrinks and turns, the halo drifts at its own rate (depth parallax) and the copy
 * fades in the last 40% so the next section reads as a continuation. Fine pointers also get a light pointer parallax.
 * Reduced motion gets the end state, no tween, no pointer tracking.
 */
export function PartnersHero() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const q = (k: string) => el.querySelector<HTMLElement>(`[data-hero="${k}"]`);
      const left = q("left");
      const right = q("right");
      const orb = q("orb");
      const halo = q("halo");
      const copy = q("copy");
      if (!left || !right || !orb || !halo || !copy) return;

      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const tl = gsap.timeline({
          defaults: { ease: "none", duration: 1 },
          scrollTrigger: { trigger: el, start: "top top", end: "bottom bottom", scrub: 0.6, invalidateOnRefresh: true },
        });
        // Depth parallax on the scroll: the near layers (hands) sink a little while the far ones (stone, halo) rise, so
        // the stage reads as three planes rather than one flat picture.
        tl.fromTo(left, { xPercent: -14, yPercent: 0, scale: 1 }, END.left, 0)
          .fromTo(right, { xPercent: 14, yPercent: 0, scale: 1 }, END.right, 0)
          .fromTo(orb, { yPercent: 0, scale: 1, rotation: 0 }, END.orb, 0)
          .fromTo(halo, { yPercent: 0, scale: 1 }, { yPercent: -18, scale: 1.2 }, 0)
          .fromTo(copy, { opacity: 1, y: 0 }, { opacity: 0.15, y: -24, duration: 0.4 }, 0.6);

        // Pointer parallax (fine pointers only): each plane follows the cursor by a different amount, far planes less
        // and the halo against the motion. GSAP's x/y compose with the scrubbed xPercent/scale, so the two never fight.
        const fine = window.matchMedia("(pointer: fine)").matches;
        let onMove: ((e: PointerEvent) => void) | undefined;
        let onLeave: (() => void) | undefined;
        if (fine) {
          const opts = { duration: 0.9, ease: "power3.out" };
          const set = [
            { el: left, dx: 22, dy: 14 },
            { el: right, dx: 22, dy: 14 },
            { el: orb, dx: 10, dy: 8 },
            { el: halo, dx: -16, dy: -10 },
          ].map(({ el: node, dx, dy }) => ({ x: gsap.quickTo(node, "x", opts), y: gsap.quickTo(node, "y", opts), dx, dy }));
          onMove = (e) => {
            const nx = (e.clientX / window.innerWidth) * 2 - 1;
            const ny = (e.clientY / window.innerHeight) * 2 - 1;
            for (const p of set) {
              p.x(nx * p.dx);
              p.y(ny * p.dy);
            }
          };
          onLeave = () => {
            for (const p of set) {
              p.x(0);
              p.y(0);
            }
          };
          el.addEventListener("pointermove", onMove, { passive: true });
          el.addEventListener("pointerleave", onLeave, { passive: true });
        }
        let live = true;
        void document.fonts?.ready.then(() => live && ScrollTrigger.refresh());
        return () => {
          live = false;
          if (onMove) el.removeEventListener("pointermove", onMove);
          if (onLeave) el.removeEventListener("pointerleave", onLeave);
        };
      });
      mm.add(REDUCED, () => {
        gsap.set(left, END.left);
        gsap.set(right, END.right);
        gsap.set(orb, END.orb);
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} className={s.hero} aria-labelledby="partners-title">
      <div className={s.stage}>
        <HeroArt />
        <div data-hero="copy" className={s.copy}>
          <h1 id="partners-title" className={`display ${s.title}`}>
            Let&apos;s grow together.
          </h1>
          <p className={s.sub}>Create content. Share Outlly. Get rewarded.</p>
          <p className={s.desc}>
            We partner with creators who love discovering useful tools and sharing them with their audience. Whether you have
            1,000 followers or 100,000, we&apos;d love to hear from you.
          </p>
          <div className={s.ctas}>
            <a href="#apply" className={s.primary}>
              Apply for Partnership
              <ArrowRight className={`${s.arrow} h-4 w-4`} aria-hidden="true" />
            </a>
            <a href="#how" className={s.secondary}>
              How it works
            </a>
          </div>
        </div>
        <div className={s.icons}>
          <span className="sr-only">Creators on Instagram, YouTube, TikTok and X</span>
          <Instagram aria-hidden="true" />
          <Youtube aria-hidden="true" />
          <Music2 aria-hidden="true" />
          <Twitter aria-hidden="true" />
          <Globe aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
