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
/** Timeline progress (0..1 over the section's own scroll) at which the palms meet. */
const CONTACT = 0.55;
/** The cross-fade from the two open hands to the clasped handshake artwork, a short window around CONTACT. */
const SWAP = { at: CONTACT - 0.02, duration: 0.06 };
/** The clasped pose: both hands at 88% size, each fingertip 12% of a hand's width past the centre line. */
const CLASP = { scale: 0.88, lap: 0.12 };
/**
 * Where each hand touches the other, as fractions of its own image box (measured from the halftone dots):
 * the robot's fingertip, and the human's fingertips, which land a little lower so the open palm reads as wrapping
 * the robot's fingers. Both are also the hands' transform origins (hero.module.css), so scaling never moves them.
 */
const ANCHOR = {
  left: { x: 0.94, y: 0.5, side: 1, drop: 0 },
  right: { x: 0.01, y: 0.5, side: -1, drop: 0.02 },
} as const;
/**
 * The hands' rest state before the scroll: at the edges, a little open, full size. x/y are pinned to 0 because GSAP
 * reads the CSS rest transform as a px translation; without them the scrubbed xPercent would stack on top of it.
 */
const START = {
  left: { x: 0, y: 0, xPercent: -14, yPercent: 0, rotation: -5, scale: 1 },
  right: { x: 0, y: 0, xPercent: 14, yPercent: 0, rotation: 5, scale: 1 },
};

/**
 * Where a hand has to translate (as a percentage of its own box, so it never fights the px pointer parallax) for
 * its anchor to land on the clasp point: the stage's centre line, at `--clasp-y` of the stage's height. Read at
 * refresh time, so a resize or a late font keeps the pose true.
 */
function pose(stage: HTMLElement, hand: HTMLElement, a: (typeof ANCHOR)[keyof typeof ANCHOR]) {
  const w = hand.offsetWidth;
  const h = hand.offsetHeight;
  const cy = parseFloat(getComputedStyle(stage).getPropertyValue("--clasp-y")) || 0.7;
  const we = w * CLASP.scale;
  const tx = stage.offsetWidth / 2 + a.side * CLASP.lap * we;
  const ty = stage.offsetHeight * cy + a.drop * we;
  return {
    xPercent: ((tx - (hand.offsetLeft + a.x * w)) / w) * 100,
    yPercent: ((ty - (hand.offsetTop + a.y * h)) / h) * 100,
  };
}

/**
 * R1282 /partners hero, R1302 handshake. The section is taller than the screen and its stage is CSS-sticky (no pin
 * spacer under Lenis, which already drives the window scroll that ScrollTrigger reads). One scrubbed timeline over
 * the section's own scroll: the hands travel in from the edges and meet palm to palm below the copy (CONTACT), the
 * stone shrinks and fades as they close on it, the halo drifts at its own rate (depth parallax), the copy lifts and
 * fades right out before the hands meet (R1303: nothing is ever read through the artwork), so the clasp becomes the picture. Around CONTACT the open hands cross-fade into the clasped handshake artwork
 * (public/partners/handshake.svg) and a short time-based beat plays once: a lime burst between the palms and the
 * clasp pumping down and up, damped, like a real shake. Fine pointers also get a light pointer
 * parallax. Reduced motion gets the clasped end state, no tween, no pointer tracking.
 */
export function PartnersHero() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const q = (k: string) => el.querySelector<HTMLElement>(`[data-hero="${k}"]`);
      const stage = q("stage");
      const left = q("left");
      const right = q("right");
      const clasp = q("clasp");
      const orb = q("orb");
      const halo = q("halo");
      const burst = q("burst");
      const shake = q("shake");
      const copy = q("copy");
      if (!stage || !left || !right || !clasp || !orb || !halo || !burst || !shake || !copy) return;
      const endL = () => pose(stage, left, ANCHOR.left);
      const endR = () => pose(stage, right, ANCHOR.right);

      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const tl = gsap.timeline({
          defaults: { ease: "none", duration: 1 },
          scrollTrigger: { trigger: el, start: "top top", end: "bottom bottom", scrub: 0.6, invalidateOnRefresh: true },
        });
        // The approach: both hands ease in and settle into the clasp by CONTACT, each turning upright as it arrives,
        // then cross-fade into the clasped handshake (SWAP) as the burst below covers the join. The stone (far plane)
        // is overtaken and fades; the halo rises at its own rate; after contact the clasp drifts up a touch. The copy is
        // gone by 0.5, before SWAP: the headline, sub-line and CTAs are read in full or not at all, never under the artwork.
        tl.fromTo(left, START.left, { xPercent: () => endL().xPercent, yPercent: () => endL().yPercent, rotation: 0, scale: CLASP.scale, duration: CONTACT, ease: "power2.inOut" }, 0)
          .fromTo(right, START.right, { xPercent: () => endR().xPercent, yPercent: () => endR().yPercent, rotation: 0, scale: CLASP.scale, duration: CONTACT, ease: "power2.inOut" }, 0)
          .fromTo(left, { opacity: 1 }, { opacity: 0, duration: SWAP.duration }, SWAP.at)
          .fromTo(right, { opacity: 1 }, { opacity: 0, duration: SWAP.duration }, SWAP.at)
          .fromTo(shake, { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: SWAP.duration }, SWAP.at)
          .fromTo(orb, { yPercent: 0, scale: 1, rotation: 0, opacity: 1 }, { yPercent: -10, scale: 0.5, rotation: 26, opacity: 0, duration: CONTACT - 0.08, ease: "power1.in" }, 0.08)
          .fromTo(halo, { yPercent: 0, scale: 1 }, { yPercent: -18, scale: 1.25 }, 0)
          .fromTo(clasp, { yPercent: 0 }, { yPercent: -5, duration: 1 - CONTACT }, CONTACT)
          .fromTo(copy, { opacity: 1, y: 0 }, { opacity: 0, y: -48, duration: 0.3 }, 0.2);

        // The handshake, time-based so it always completes: a lime burst blooms where the palms meet while the
        // whole clasp pumps down and up about that point, each swing smaller than the last. Fired once the scroll
        // passes CONTACT (the short delay lets the scrubbed hands catch up); rewound if the scroll backs out.
        const meet = gsap.timeline({ paused: true, delay: 0.3 });
        meet
          .fromTo(burst, { scale: 0.3, opacity: 0 }, { scale: 1.05, opacity: 0.95, duration: 0.22, ease: "power2.out" }, 0)
          .to(burst, { scale: 1.6, opacity: 0, duration: 0.5, ease: "sine.out" }, 0.22)
          .to(clasp, { y: -12, rotation: -2.2, duration: 0.16, ease: "sine.inOut" }, 0.05)
          .to(clasp, { y: 9, rotation: 1.8, duration: 0.18, ease: "sine.inOut" }, ">")
          .to(clasp, { y: -6, rotation: -1.2, duration: 0.17, ease: "sine.inOut" }, ">")
          .to(clasp, { y: 3, rotation: 0.6, duration: 0.16, ease: "sine.inOut" }, ">")
          .to(clasp, { y: 0, rotation: 0, duration: 0.32, ease: "power2.out" }, ">");
        const contact = ScrollTrigger.create({
          trigger: el,
          start: () => `top+=${Math.round(CONTACT * (el.offsetHeight - stage.offsetHeight))} top`,
          onEnter: () => void meet.restart(true),
          onLeaveBack: () => void meet.pause(0),
        });

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
            { el: shake, dx: 22, dy: 14 },
            { el: burst, dx: 22, dy: 14 },
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
          contact.kill();
          meet.kill();
          if (onMove) el.removeEventListener("pointermove", onMove);
          if (onLeave) el.removeEventListener("pointerleave", onLeave);
        };
      });
      mm.add(REDUCED, () => {
        // The clasped handshake, in place of the open hands and the stone; re-measured on resize so it stays under the copy.
        const rest = () => {
          gsap.set(left, { ...endL(), rotation: 0, scale: CLASP.scale, opacity: 0 });
          gsap.set(right, { ...endR(), rotation: 0, scale: CLASP.scale, opacity: 0 });
          gsap.set(shake, { opacity: 1 });
          gsap.set(orb, { opacity: 0 });
        };
        rest();
        window.addEventListener("resize", rest);
        return () => window.removeEventListener("resize", rest);
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} className={s.hero} aria-labelledby="partners-title">
      <div data-hero="stage" className={s.stage}>
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
