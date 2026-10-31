"use client";
import { useEffect } from "react";
import { scrambleInto, scrambleOver } from "@/lib/motion/scramble";

/**
 * Text interaction layer (1069), wired once with delegated listeners:
 * - FlipText: when the pointer arrives on (or keyboard focus lands on) the link or button that holds one,
 *   its back face scrambles into the word as it rolls up (350 ms, like the reference nav).
 * - ScrambleText [data-scramble]: "view" decodes once when it scrolls into sight, "hover" each time the
 *   pointer arrives. A run that is still going is left alone, so sweeping across it does not restart it.
 * Reduced motion switches all of it off; the words just sit there.
 */
const HOST = "a, button, [role='button'], [role='tab'], [role='menuitem']";

export function TextFx() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const entering = (zone: Element, e: PointerEvent | FocusEvent) => !(e.relatedTarget instanceof Node && zone.contains(e.relatedTarget));

    const flip = (host: Element) => {
      host.querySelectorAll<HTMLElement>(".ft-back").forEach((b) => scrambleInto(b, b.dataset.text ?? b.textContent ?? "", 350));
    };
    const hover = (el: HTMLElement) => {
      if (el.hasAttribute("data-scrambling")) return;
      if (el.dataset.scramble === "view") return;
      scrambleOver(el, 450);
    };

    const onOver = (e: PointerEvent) => {
      if (reduce.matches || e.pointerType !== "mouse") return;
      const t = e.target as Element | null;
      if (!t?.closest) return;
      const host = t.closest(HOST);
      if (host && host.querySelector(".ft-back") && entering(host, e)) flip(host);
      const s = t.closest<HTMLElement>("[data-scramble]");
      if (s && entering(s, e)) hover(s);
    };
    const onFocus = (e: FocusEvent) => {
      if (reduce.matches) return;
      const t = e.target as Element | null;
      let kb = false;
      try {
        kb = !!t?.matches?.(":focus-visible");
      } catch {}
      if (kb && t?.querySelector(".ft-back")) flip(t);
    };
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("focusin", onFocus);
    };
  }, []);

  // "view" scrambles: watch whatever the page renders, including pages that arrive later through a route
  // transition (the layout stays mounted), so a MutationObserver picks up new ones.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeof IntersectionObserver === "undefined") return;
    const timers: number[] = [];
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          io.unobserve(en.target);
          // a beat after it arrives, so it decodes while the section reveal fades it in
          timers.push(window.setTimeout(() => scrambleOver(en.target as HTMLElement, 900), 160));
        }
      },
      { threshold: 0.9 },
    );
    const seen = new WeakSet<Element>();
    let raf = 0;
    const scan = () => {
      raf = 0;
      document.querySelectorAll<HTMLElement>("[data-scramble='view'], [data-scramble='both']").forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        io.observe(el);
      });
    };
    scan();
    const mo = new MutationObserver(() => {
      if (!raf) raf = requestAnimationFrame(scan);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      mo.disconnect();
      io.disconnect();
    };
  }, []);

  return null;
}
