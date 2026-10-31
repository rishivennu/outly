/**
 * Text scramble (1069, after vennu-orcin.vercel.app): random characters settle into the real text from
 * left to right. Written only into elements screen readers skip (an aria-hidden overlay or the hidden
 * back face of a FlipText), so the accessible text never changes while it runs. One run per element;
 * starting another cancels the first. Callers check prefers-reduced-motion.
 */
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&*!?";
const STEP = 40; // ms between new random characters, the reference speed
const runs = new WeakMap<Element, number>();

const esc = (c: string) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c);

/**
 * One frame of the decode at progress p (0..1): revealed characters as text, the rest as random .scr-x spans.
 * `widths` (px, one per character) pins each random glyph to the width of the real letter it stands in for,
 * so a "W" in the slot of an "i" cannot widen the word and shove its neighbours about.
 */
export function scrambleFrame(text: string, p: number, rand: () => number = Math.random, widths?: readonly number[]): string {
  const chars = Array.from(text);
  const n = chars.length || 1;
  const head = p * 1.15 - 0.15; // the reference reveals char i once progress passes i/len + .15; stretched so p=1 ends it
  let out = "";
  chars.forEach((c, i) => {
    if (/\s/.test(c) || i / n < head) out += esc(c);
    else {
      const w = widths?.[i];
      const box = w != null && Number.isFinite(w) ? ` style="width:${Math.round(w * 100) / 100}px"` : "";
      out += `<span class="scr-x"${box}>${esc(CHARS[Math.floor(rand() * CHARS.length)])}</span>`;
    }
  });
  return out;
}

/** Width in px of every character of el's text as laid out right now (el must hold exactly `text`). */
function measureChars(el: HTMLElement, text: string): number[] | undefined {
  const node = el.firstChild;
  if (!node || node.nodeType !== 3 || typeof document.createRange !== "function") return undefined;
  const r = document.createRange();
  const out: number[] = [];
  let at = 0;
  for (const c of Array.from(text)) {
    r.setStart(node, at);
    r.setEnd(node, at + c.length);
    out.push(r.getBoundingClientRect().width);
    at += c.length;
  }
  return out;
}

const locked = new WeakSet<HTMLElement>();
const unlock = (el: Element) => {
  if (el instanceof HTMLElement && locked.has(el)) {
    el.style.width = "";
    locked.delete(el);
  }
};

export function cancelScramble(el: Element) {
  const id = runs.get(el);
  if (id) cancelAnimationFrame(id);
  runs.delete(el);
  unlock(el);
}

export function scrambleInto(el: HTMLElement, text: string, ms = 350, done?: () => void) {
  cancelScramble(el);
  // Measure the settled word first, then hold the box at that exact px width for the whole run.
  // Rects are on-screen sizes, and a FlipText back is mid-3D-tilt (bigger on screen than in layout), so the
  // box comes from the computed layout width and the letter widths are scaled to it.
  el.textContent = text;
  const seen = el.getBoundingClientRect().width;
  const used = parseFloat(getComputedStyle(el).width);
  const box = Number.isFinite(used) && used > 0 ? used : el.offsetWidth;
  const k = seen > 0 ? box / seen : 1;
  const widths = measureChars(el, text)?.map((w) => w * k);
  if (box > 0 && !el.style.width) {
    el.style.width = `${box}px`;
    locked.add(el);
  }
  const t0 = performance.now();
  let last = -1;
  const tick = (now: number) => {
    const p = Math.min(1, (now - t0) / ms);
    if (p >= 1) {
      el.textContent = text;
      unlock(el);
      runs.delete(el);
      done?.();
      return;
    }
    const step = Math.floor((now - t0) / STEP);
    if (step !== last) {
      last = step;
      el.innerHTML = scrambleFrame(text, p, Math.random, widths);
    }
    runs.set(el, requestAnimationFrame(tick));
  };
  runs.set(el, requestAnimationFrame(tick));
}

/**
 * Scramble a ScrambleText (.scr) in place: the real text turns transparent (so the line keeps its exact
 * width and nothing reflows) and an aria-hidden overlay on top runs the decode, then goes away.
 */
export function scrambleOver(host: HTMLElement, ms = 600) {
  const real = host.querySelector<HTMLElement>(":scope > .scr-t");
  const text = real?.textContent ?? "";
  if (!text.trim()) return;
  let o = host.querySelector<HTMLElement>(":scope > .scr-o");
  if (!o) {
    o = document.createElement("span");
    o.className = "scr-o";
    o.setAttribute("aria-hidden", "true");
    host.appendChild(o);
  }
  const overlay = o;
  host.setAttribute("data-scrambling", "");
  scrambleInto(overlay, text, ms, () => {
    host.removeAttribute("data-scrambling");
    overlay.remove();
  });
}
