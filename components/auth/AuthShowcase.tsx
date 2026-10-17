"use client";
import { useRef } from "react";
import { usePathname } from "next/navigation";
import { OutlyMark } from "@/components/brand/Logo";
import { MOTION_OK, gsap, useGSAP } from "@/lib/motion/gsap";

/**
 * Where each colour blob sits, per route. The panel lives in the shared layout, so switching between
 * sign in and sign up keeps it mounted and the light simply drifts to a new spot instead of reloading.
 * Values are percentages of the blob's own size (xPercent / yPercent) plus a scale.
 */
const POSE = {
  login: [
    { x: 0, y: 0, s: 1 },
    { x: 0, y: 0, s: 1 },
    { x: 0, y: 0, s: 1 },
  ],
  signup: [
    { x: -34, y: -8, s: 1.1 },
    { x: 22, y: -18, s: 0.94 },
    { x: -70, y: 12, s: 1.15 },
  ],
  admin: [
    { x: 18, y: 30, s: 0.9 },
    { x: 30, y: -24, s: 1.05 },
    { x: -40, y: 50, s: 0.85 },
  ],
} as const;

/**
 * Left half of the auth card: a rounded panel of soft brand light (lime, deep green and a cream highlight
 * melting into ink), with the mark top left and the promise bottom left. Decorative, so it is hidden from
 * assistive tech; the form carries the meaning. GSAP: an entrance, a slow ambient drift, a light that leans
 * toward the pointer, and a glide to a new composition when the route changes. Reduced motion gets a still frame.
 */
export function AuthShowcase({ eyebrow = "With Outlly you can", lines = ["Make it once and", "post it everywhere"] }: { eyebrow?: string; lines?: [string, string] } = {}) {
  const ref = useRef<HTMLElement>(null);
  const path = usePathname();
  const pose = path.startsWith("/signup") ? "signup" : path.startsWith("/admin") ? "admin" : "login";
  const first = useRef(true);

  // Entrance + ambient life (once per mount).
  useGSAP(() => {
    const root = ref.current;
    if (!root) return;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      const q = gsap.utils.selector(root);
      gsap.timeline({ defaults: { ease: "power3.out" } })
        .fromTo(q(".as-mesh"), { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1, duration: 1.4, ease: "power2.out" }, 0)
        .fromTo(q(".as-mark"), { opacity: 0, scale: 0.6, rotation: -20 }, { opacity: 1, scale: 1, rotation: 0, duration: 0.8, ease: "back.out(2)" }, 0.25)
        .fromTo(q(".as-eyebrow"), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5 }, 0.45)
        .fromTo(q(".as-line > span"), { yPercent: 110 }, { yPercent: 0, duration: 0.9, ease: "power4.out", stagger: 0.09 }, 0.5);

      // Each blob breathes on its own slow loop, on the innermost layer, so the route pose (outer) and the pointer lean (middle) never fight it.
      q(".as-drift").forEach((el, i) => {
        gsap.to(el, { x: [40, -50, 30][i], y: [-30, 40, -45][i], scale: [1.08, 0.94, 1.12][i], duration: 9 + i * 2.5, ease: "sine.inOut", yoyo: true, repeat: -1 });
      });

      // The lime light leans a little toward the pointer. Mouse and pen only.
      const lean = q(".as-lean")[0];
      if (lean) {
        const x = gsap.quickTo(lean, "x", { duration: 2.2, ease: "power3" });
        const y = gsap.quickTo(lean, "y", { duration: 2.2, ease: "power3" });
        const onMove = (e: PointerEvent) => {
          if (e.pointerType === "touch") return;
          const r = root.getBoundingClientRect();
          x(((e.clientX - r.left) / r.width - 0.5) * 70);
          y(((e.clientY - r.top) / r.height - 0.5) * 70);
        };
        window.addEventListener("pointermove", onMove, { passive: true });
        return () => window.removeEventListener("pointermove", onMove);
      }
    }, root);
    root.dataset.gsReady = "1";
  }, { scope: ref });

  // Route change: glide the composition. First paint just sets it.
  useGSAP(() => {
    const blobs = ref.current?.querySelectorAll<HTMLElement>(".as-pose");
    if (!blobs?.length) return;
    const at = POSE[pose];
    const still = first.current || !window.matchMedia(MOTION_OK).matches;
    blobs.forEach((el, i) => {
      const p = at[i] ?? at[0];
      const v = { xPercent: p.x, yPercent: p.y, scale: p.s };
      if (still) gsap.set(el, v);
      else gsap.to(el, { ...v, duration: 1.6, ease: "power3.inOut", overwrite: "auto" });
    });
    first.current = false;
  }, { dependencies: [pose], scope: ref });

  return (
    <section
      ref={ref}
      aria-hidden="true"
      className="gs-stage relative isolate hidden min-h-[560px] flex-col justify-between overflow-hidden rounded-[22px] bg-[hsl(240_10%_6%)] p-8 text-white sm:rounded-[26px] lg:flex xl:p-10"
    >
      {/* The light. Blurred blobs on a near-black base; an ink pool bottom left keeps the copy readable. */}
      <div className="as-mesh pointer-events-none absolute inset-0 -z-10">
        <span className="as-pose absolute -right-[22%] -top-[18%] h-[78%] w-[86%]">
          <span className="as-lean block h-full w-full">
            <span className="as-drift block h-full w-full rounded-full bg-[hsl(78_100%_50%)] opacity-90 blur-[70px] will-change-transform" />
          </span>
        </span>
        <span className="as-pose absolute -left-[28%] top-[14%] h-[72%] w-[78%]">
          <span className="as-drift block h-full w-full rounded-full bg-[hsl(140_70%_22%)] opacity-95 blur-[80px] will-change-transform" />
        </span>
        <span className="as-pose absolute right-[2%] top-[4%] h-[34%] w-[42%]">
          <span className="as-drift block h-full w-full rounded-full bg-[hsl(60_70%_92%)] opacity-80 blur-[60px] will-change-transform" />
        </span>
        <span className="absolute -bottom-[22%] -left-[18%] h-[62%] w-[96%] rounded-full bg-[hsl(240_10%_5%)] blur-[60px]" />
        <span className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-[hsl(240_10%_5%/0.9)] via-[hsl(240_10%_5%/0.45)] to-transparent" />
        <span className="auth-grain absolute inset-0 opacity-[0.16] mix-blend-overlay" />
      </div>

      <OutlyMark variant="white" size={44} className="as-mark gs-in" />

      <div className="relative max-w-[440px]">
        <p className="as-eyebrow gs-in text-[15px] font-medium text-white/80">{eyebrow}</p>
        <p className="mt-3 font-display text-[clamp(1.85rem,2.6vw,2.35rem)] font-bold leading-[1.04] tracking-[-0.03em]">
          <span className="as-line block overflow-hidden pb-[0.06em]"><span className="block">{lines[0]}</span></span>
          <span className="as-line block overflow-hidden pb-[0.06em]"><span className="block">{lines[1]}</span></span>
        </p>
      </div>
    </section>
  );
}
