"use client";
import { useEffect, useRef } from "react";

/**
 * Comets fired at random from the top-left, each crossing the full view toward the bottom right.
 * Start points are spread along the top and left edges, so over a few seconds the streaks cover the
 * whole canvas, not one band. Web Animations on transform + opacity only (compositor), one element
 * per comet, removed when it lands. Pauses while the tab is hidden; off for reduced motion.
 */
export function CometShower({ dense = false }: { dense?: boolean }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || typeof window === "undefined") return;
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setTimeout> | null = null;
    let live = 0;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    const fire = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (live >= (w < 640 ? 2 : dense ? 6 : 4)) return;
      // Pick a launch point on the top edge or the left edge, weighted by their lengths.
      const onTop = Math.random() < w / (w + h);
      const x = onTop ? rand(-0.25 * w, 0.85 * w) : -40;
      const y = onTop ? -40 : rand(-0.05 * h, 0.85 * h);
      const ang = (Math.atan2(h, w) * 180) / Math.PI + rand(-9, 9);
      const len = Math.round(rand(110, 240));
      const travel = Math.hypot(w, h) * rand(0.95, 1.25);
      const dur = rand(1500, 2900) * (travel / 1600) ** 0.5;

      const c = document.createElement("span");
      c.className = "sky-comet";
      c.style.left = `${x}px`;
      c.style.top = `${y}px`;
      c.style.transform = `rotate(${ang}deg)`;
      const tail = document.createElement("span");
      tail.style.width = `${len}px`;
      tail.style.animation = "none";
      c.appendChild(tail);
      el.appendChild(c);
      live++;
      const anim = tail.animate(
        [
          { transform: "translateX(0)", opacity: 0 },
          { opacity: 1, offset: 0.08 },
          { opacity: 0.9, offset: 0.75 },
          { transform: `translateX(${travel}px)`, opacity: 0 },
        ],
        { duration: dur, easing: "cubic-bezier(.35,.1,.65,1)" },
      );
      const done = () => {
        c.remove();
        live--;
      };
      anim.onfinish = done;
      anim.oncancel = done;
    };

    const schedule = () => {
      timer = setTimeout(() => {
        if (!document.hidden && !rm.matches) {
          fire();
          if (Math.random() < 0.18) setTimeout(fire, rand(120, 420)); // the odd pair, like a real shower
        }
        schedule();
      }, dense ? rand(400, 1600) : rand(700, 2600));
    };
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
      el.replaceChildren();
    };
  }, [dense]);

  return <div ref={host} className="absolute inset-0" />;
}
