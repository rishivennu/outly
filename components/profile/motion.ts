/**
 * 1120: the profile card's motion, from the brief. Every curve is the token ease (0.16, 1, 0.3, 1); the numbers are
 * the brief's: card 450ms fade + rise, banner 600ms fade, avatar 500ms scale + fade, stats 1000ms (NUMBER_TIMING
 * .profile), hover 200ms (CSS, .pcard), edit actions 180ms.
 */
import { DUR, EASE, sec } from "@/lib/motion/tokens";

const out = EASE.out as unknown as number[];
export const PC_MS = { card: DUR.card, banner: DUR.section, avatar: 500, stats: DUR.count, hover: 200, action: DUR.hover } as const;

export const PC = {
  card: { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { type: "tween" as const, duration: sec("card"), ease: out } },
  banner: { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { type: "tween" as const, duration: sec("section"), ease: out, delay: 0.05 } },
  avatar: { initial: { opacity: 0, scale: 0.9 }, animate: { opacity: 1, scale: 1 }, transition: { type: "tween" as const, duration: PC_MS.avatar / 1000, ease: out, delay: 0.12 } },
  /** Edit controls appearing (the bio pencil's field, a sheet's rows): 180ms. */
  action: { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 2 }, transition: { type: "tween" as const, duration: PC_MS.action / 1000, ease: out } },
  fade: { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { type: "tween" as const, duration: 0.15, ease: "linear" as const } },
} as const;
