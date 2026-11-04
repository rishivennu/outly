/**
 * 1119: the one motion vocabulary for Outlly. Every duration, curve and stagger in the app comes from here
 * (TypeScript: framer-motion presets, GSAP eases, Recharts timing) or from the matching CSS custom properties
 * in app/globals.css (`--m-*`, also exposed as Tailwind `duration-*` / `ease-*` names). Change a number here and
 * in the CSS block together; tests/round-1119-motion.test.ts checks they agree.
 *
 * Studied from kyma.framer.ai (11-04): its entrances are a short rise (20 to 50px) plus fade, played once when
 * half the block is in view, on an overdamped spring or a .6s ease-out, 100ms apart; text arrives line by line
 * or word by word; images settle from a slight zoom while they appear; state swaps (hover variants, tabs) use
 * an expo in-out; small loops (a blinking live dot, a slow conic ring) carry "it's alive" without moving layout.
 * Adapted, not copied: Outlly keeps its own masks and brand, and nothing here bounces or follows the scrollbar.
 *
 * Rules (USER RULES, 1064 brief, 1119 brief):
 * - Time-based only. Scroll can START an entrance (once), it never scrubs one.
 * - No overshoot. Every curve stays inside 0..1; springs are only ever `bounce: 0` (critically damped).
 * - Exits are quicker than entrances (about two thirds) and use the `in` curve, so leaving never lingers.
 * - Only opacity, transform and clip-path animate on entrances; colour and shadow only on hover.
 * - Reduced motion: no travel, no stagger, short fades (MotionRoot reducedMotion="user" + CSS media queries).
 *
 * Timings table (ms) | brief range | where
 * ------------------ | ----------- | -----
 * press   160        | 150-200     | button press, tap feedback, switch knob
 * hover   180        | 150-200     | hover fills, colour, border, icon nudge
 * menu    220        | 200-250     | dropdowns, popovers, tooltips (exit 150)
 * nav     300        | 250-350     | sidebar, drawer, tab and segmented indicators
 * page    420        | 350-450     | route transitions (lib/motion/route.ts)
 * card    450        | 400-500     | card entrance, dialog, sheet
 * section 600        | 500-700     | section reveal (lib/motion/reveal.ts)
 * chart   700        | 600-800     | chart series draw
 * count   1000       | 900-1200    | number counters (tiers in lib/motion/numbers.ts: 800 to 1200)
 * stagger 70         | 60-100      | between siblings; a wave never adds more than 420ms in total
 */

export type Bezier = readonly [number, number, number, number];

export const DUR = {
  press: 160,
  hover: 180,
  menu: 220,
  menuExit: 150,
  nav: 300,
  page: 420,
  card: 450,
  section: 600,
  chart: 700,
  count: 1000,
} as const;
export type DurName = keyof typeof DUR;

export const STAGGER = 70;
/** The longest a whole staggered group may wait for its last item. */
export const STAGGER_CAP = 420;
/** Delay for item i in a group, never more than STAGGER_CAP (so long lists do not hold content back). */
export const staggerAt = (i: number, step = STAGGER) => Math.min(Math.max(0, i) * step, STAGGER_CAP);

export const EASE = {
  /** Entrances and anything settling into place: fast start, long soft landing (the brief's curve). */
  out: [0.16, 1, 0.3, 1],
  /** A swap between two resting states (tab pill, toggle, segmented control): kyma's expo in-out. */
  swap: [0.87, 0, 0.13, 1],
  /** Exits: gathers speed and is gone. */
  in: [0.7, 0, 0.84, 0],
  /** Colour and opacity hovers, where a fast start would read as a flicker. */
  std: [0.4, 0, 0.2, 1],
} as const satisfies Record<string, Bezier>;
export type EaseName = keyof typeof EASE;

/** A mutable copy for framer-motion `ease:` props. */
export const ease = (name: EaseName) => [...EASE[name]] as [number, number, number, number];
export const cssEase = (name: EaseName) => `cubic-bezier(${EASE[name].join(", ")})`;
export const cssDur = (name: DurName) => `${DUR[name]}ms`;
/** e.g. css("opacity", "menu") -> "opacity 220ms cubic-bezier(0.16, 1, 0.3, 1)" */
export const cssT = (prop: string, dur: DurName, ease: EaseName = "out") => `${prop} ${cssDur(dur)} ${cssEase(ease)}`;

/** GSAP names for the same curves: expo.out matches EASE.out to within a frame, expo.inOut matches EASE.swap. */
export const GSAP_EASE = { out: "expo.out", swap: "expo.inOut", in: "power3.in", std: "power2.out" } as const;
/** GSAP takes seconds. */
export const sec = (name: DurName) => DUR[name] / 1000;

/** framer-motion transitions (seconds). */
const tween = (dur: DurName, ease: EaseName = "out", delay = 0) => ({ type: "tween" as const, duration: sec(dur), ease: EASE[ease] as unknown as number[], ...(delay ? { delay } : {}) });
export const T = {
  press: tween("press", "out"),
  hover: tween("hover", "std"),
  menu: tween("menu", "out"),
  menuExit: tween("menuExit", "in"),
  nav: tween("nav", "out"),
  page: tween("page", "out"),
  card: tween("card", "out"),
  section: tween("section", "out"),
  /** A shared-layout indicator (layoutId pill) moving between tabs. A critically damped spring timed like `nav`,
   *  so quick repeated clicks keep their speed instead of restarting from rest; it never overshoots. */
  glide: { type: "spring" as const, bounce: 0, duration: sec("nav") },
  /** Width/height of a progress fill: a swap between two values. */
  fill: tween("nav", "swap"),
  /** Reduced motion: a short fade and nothing else. */
  fade: { type: "tween" as const, duration: 0.15, ease: "linear" as const },
  at: tween,
} as const;

/**
 * Entrance presets: initial / animate / exit plus transition, so every dialog, popover, sheet and toast in the
 * app arrives the same way. Spread onto a motion element: <motion.div {...FX.dialog}>. Distances are small on
 * purpose (kyma moves 20 to 50px on a full-width page; inside an app panel 6 to 16px reads the same).
 */
export const FX = {
  /** Centered dialog: rises 16px and grows from 98%. */
  dialog: {
    initial: { opacity: 0, y: 16, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1, transition: T.card },
    exit: { opacity: 0, y: 8, scale: 0.99, transition: tween("menu", "in") },
  },
  /** Dropdown / popover hanging from its trigger: drops 6px, grows from 97% (set transform-origin at the trigger). */
  pop: {
    initial: { opacity: 0, y: -6, scale: 0.97 },
    animate: { opacity: 1, y: 0, scale: 1, transition: T.menu },
    exit: { opacity: 0, y: -4, scale: 0.98, transition: T.menuExit },
  },
  /** Bottom sheet (phones). */
  sheet: {
    initial: { opacity: 0, y: 32 },
    animate: { opacity: 1, y: 0, transition: T.card },
    exit: { opacity: 0, y: 24, transition: tween("menu", "in") },
  },
  /** Toast / pill notice. */
  toast: {
    initial: { opacity: 0, y: 16, scale: 0.97 },
    animate: { opacity: 1, y: 0, scale: 1, transition: T.card },
    exit: { opacity: 0, y: 8, scale: 0.98, transition: T.menuExit },
  },
  /** A card or panel arriving in place (no scroll trigger: on mount). */
  card: {
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0, transition: T.card },
    exit: { opacity: 0, transition: T.menuExit },
  },
  /** A step in a wizard replacing the one before (dir 1 = forward). */
  step: (dir: 1 | -1 = 1) => ({
    initial: { opacity: 0, x: 24 * dir },
    animate: { opacity: 1, x: 0, transition: T.page },
    exit: { opacity: 0, x: -16 * dir, transition: tween("menu", "in") },
  }),
  /** Reduced motion stand-in for any of the above: a short fade, nothing travels. */
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: T.fade },
    exit: { opacity: 0, transition: T.fade },
  },
  /** Backdrop behind a dialog or sheet. */
  scrim: {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: tween("menu", "std") },
    exit: { opacity: 0, transition: T.menuExit },
  },
} as const;

/** Pure checks used by the tests (and handy in review): a curve or spring that would overshoot. */
export const overshoots = (b: Bezier) => b[1] > 1 || b[1] < 0 || b[3] > 1 || b[3] < 0;
/** Damping ratio of a mass-spring (>= 1: no overshoot). */
export const dampingRatio = (stiffness: number, damping: number, mass = 1) => damping / (2 * Math.sqrt(stiffness * mass));
