import { useEffect, useRef, useState } from "react";
import { MOTION_OK } from "@/lib/motion/gsap";
import type { GsapApi } from "@/lib/motion/gsap-lazy";
import { whenSettled } from "@/lib/client/when-idle";

/**
 * 1181 (user, 11-17: the GSAP "animate text replacement" demo): a send button that types its own progress.
 * Press it and the label types itself into "Sending...", breathes while the request is in the air, then lands on
 * "Sent!" - GSAP's TextPlugin writing a character at a time, at the pace of the demo
 * (demos.gsap.com/demo/animate-text-replacement: 1 s sine.in to type it in, a 0.6 s yoyo while waiting, then the
 * last word).
 *
 * GSAP owns the label's text, so React must never write it: while the typing is on, the hook renders the resting
 * word and nothing else, and every change after that is typed into the element. Reduced motion (and a browser where
 * the plugin will not load) gets the plain word for the phase instead, swapped at once.
 *
 * TextPlugin is fetched once the page has settled, not with it. Pressing send before it lands just swaps the word.
 */
export type SendPhase = "idle" | "busy" | "done";
export type SendWords = {
  idle: string;
  /** Typed out while the request is in the air. */
  busy: string;
  /** The same word without its dots: busy <-> pulse yoyos while waiting. */
  pulse: string;
  /** The last word, once it worked. */
  done: string;
};

let ready: GsapApi | null = null;
let loading: Promise<void> | null = null;
function loadText(): Promise<void> {
  loading ??= Promise.all([import("gsap"), import("gsap/TextPlugin")])
    .then(([core, plugin]) => {
      core.gsap.registerPlugin(plugin.TextPlugin);
      ready = core.gsap;
    })
    .catch(() => void (loading = null));
  return loading;
}

export function useSendText(phase: SendPhase, words: SendWords) {
  const ref = useRef<HTMLSpanElement>(null);
  // Decided once, on the client: with motion on, GSAP has the text from the start, so React renders the resting word
  // and never overwrites a word being typed.
  const [typed] = useState(() => typeof window !== "undefined" && window.matchMedia(MOTION_OK).matches);
  const live = useRef<gsap.core.Animation | null>(null);
  const said = useRef<SendPhase>("idle");

  useEffect(() => {
    if (!typed || ready) return;
    return whenSettled(() => void loadText());
  }, [typed]);

  useEffect(() => {
    if (!typed || phase === said.current) return;
    const el = ref.current;
    const from = said.current;
    said.current = phase;
    if (!el || from === "done") return;
    const word = phase === "busy" ? words.busy : phase === "done" ? words.done : words.idle;
    live.current?.kill();
    live.current = null;
    const gsap = ready;
    if (!gsap) {
      el.textContent = word; // the plugin has not landed yet: the word still has to be right
      void loadText();
      return;
    }
    if (phase === "busy") {
      live.current = gsap
        .timeline()
        .to(el, { duration: 1, text: { value: words.busy, type: "diff" }, ease: "sine.in" })
        .to(el, { duration: 0.6, text: { value: words.pulse, type: "diff" }, ease: "sine.inOut", repeat: -1, yoyo: true });
    } else {
      // Landed, or the send failed and the button offers itself again: one short pass to the word it rests on.
      live.current = gsap.to(el, { duration: 0.4, text: { value: word, type: "diff" }, ease: "none" });
    }
  }, [phase, typed, words.busy, words.done, words.idle, words.pulse]);

  useEffect(() => () => void live.current?.kill(), []);

  return { ref, text: typed ? words.idle : words[phase] } as const;
}
