"use client";
import { useEffect, useRef, useState } from "react";
import { Pip } from "@/components/brand/Pip";
import { watchLine, type WatchState } from "@/lib/mascot/watch";

const REDUCED = "(prefers-reduced-motion: reduce)";
const clamp = (v: number, a: number) => Math.max(-a, Math.min(a, v));
/** Furthest the eyes move inside the cloud, in Pip's 120-unit box. */
const MAX_X = 7.5;
const MAX_Y = 5;

/** `value`, a beat after it stops changing, so the bubble answers the name once rather than every keystroke. */
function useSettled<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

function useReduced(): boolean {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(REDUCED);
    const on = () => setR(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return r;
}

let canvas: HTMLCanvasElement | null = null;
/** Where the caret is in a text field (screen px). Email fields hide selectionStart, so the end of the text then. */
function caretPoint(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  const mid = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  if (!(el instanceof HTMLInputElement) || !/^(text|email|tel|search|url|password)$/.test(el.type)) return mid;
  const cs = getComputedStyle(el);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  let pos: number | null = null;
  try {
    pos = el.selectionStart;
  } catch {
    pos = null;
  }
  const text = el.value.slice(0, pos ?? el.value.length);
  canvas ??= document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return mid;
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const w = cs.textAlign === "center" ? r.width / 2 - padL : Math.min(ctx.measureText(text).width - el.scrollLeft, r.width - padL - padR);
  return { x: r.left + padL + Math.max(0, w), y: mid.y };
}

/**
 * Pip watching the auth form (1075, after the "sign up component" reel): a small Pip beside a speech bubble that
 * types its line out. The eyes follow the caret of the field you're in (the pointer when no field has focus),
 * close for passwords, and the line follows the step: your name back to you, "That looks right." for an email
 * that looks like one. Purely decorative for sight; the line is also read once, politely, to screen readers.
 * Reduced motion: no eye tracking, no typing, the line just appears.
 */
export function PipWatch(props: WatchState) {
  const name = useSettled(props.name, 500);
  const email = useSettled(props.email, 350);
  const line = watchLine({ ...props, name, email });
  const reduced = useReduced();
  const pipRef = useRef<HTMLSpanElement>(null);
  const [gaze, setGaze] = useState<readonly [number, number]>([0, 0]);

  // Typing the line out: the full line is laid out at once (later letters invisible), so the bubble never resizes as it types.
  const [n, setN] = useState(line.say.length);
  useEffect(() => {
    if (reduced) return setN(line.say.length);
    setN(0);
    let i = 0;
    const t = window.setInterval(() => {
      i += 1;
      setN(i);
      if (i >= line.say.length) window.clearInterval(t);
    }, 30);
    return () => window.clearInterval(t);
  }, [line.say, reduced]);

  // Eyes: towards the caret in the focused field, else towards the pointer. One update per frame at most.
  const { focus, password } = props;
  useEffect(() => {
    if (reduced) return setGaze([0, 0]);
    let raf = 0;
    let px: { x: number; y: number } | null = null;
    const aim = (p: { x: number; y: number }) => {
      const r = pipRef.current?.getBoundingClientRect();
      if (!r) return;
      const dx = p.x - (r.left + r.width / 2);
      const dy = p.y - (r.top + r.height / 2);
      setGaze([clamp(dx / 22, MAX_X), clamp(dy / 26, MAX_Y)]);
    };
    const update = () => {
      raf = 0;
      const el = focus ? document.getElementById(focus) : null;
      if (el) aim(caretPoint(el));
      else if (px) aim(px);
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      px = { x: e.clientX, y: e.clientY };
      if (!focus) queue();
    };
    queue();
    document.addEventListener("selectionchange", queue);
    document.addEventListener("input", queue, true);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("resize", queue);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("selectionchange", queue);
      document.removeEventListener("input", queue, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", queue);
    };
  }, [focus, reduced, password]);

  // Shut eyes look a little away, up and to the side.
  const eyes: readonly [number, number] = line.shut ? [-4, -2.5] : gaze;
  return (
    <div className="pip-watch gs-in mb-4 flex h-14 items-center gap-2.5 [@media(max-height:700px)]:hidden">
      <span ref={pipRef} className="shrink-0">
        <Pip size={56} mood={line.mood} gaze={eyes} shut={line.shut} />
      </span>
      <p className="pw-bubble" aria-hidden="true">
        <span>{line.say.slice(0, n)}</span>
        <span className="pw-rest">{line.say.slice(n)}</span>
      </p>
      <p className="sr-only" aria-live="polite">{line.say}</p>
    </div>
  );
}
