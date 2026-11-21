"use client";
/*
 * R1290: the macOS style dock, ported from motion-primitives (npx motion-primitives add dock) and rebuilt on Outlly's
 * rules. Icons grow as the pointer nears them (a spring follows the pointer: SPRING_DOCK, overdamped), the label rises
 * above the one under the pointer or keyboard focus, and the panel sits on the liquid glass the sheets use.
 * Differences from the original, on purpose:
 *  - an item is a real <a> (next/link) or <button>, never a div with role=button, so Tab, Enter and screen readers work;
 *  - every item is at least 44px at rest (the touch target rule), magnified to `magnification` (64 by default);
 *  - prefers-reduced-motion: no magnification at all, labels appear with a plain fade;
 *  - the pointer position is clientX against getBoundingClientRect (the original used pageX, which drifts once the
 *    page scrolls).
 * Positioning (fixed, centred, safe-area) belongs to the caller: see components/shell/StudioDock.tsx and the admin dock.
 * R1292: the destination you are on sits on a solid lime fill (.nav-fill, dark ink) that glides between items on T.nav;
 * the dot under the icon is gone and idle icons are quiet grey (text-foreground/60, the one --nav-idle rule).
 */
import Link from "next/link";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from "framer-motion";
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { cn } from "@/lib/utils";
import { SPRING_DOCK, T } from "@/lib/motion/tokens";

const REST = 44;

type Ctx = { mouseX: MotionValue<number>; magnification: number; distance: number; still: boolean; fillId: string };
const DockContext = createContext<Ctx | null>(null);

function useDockCtx() {
  const c = useContext(DockContext);
  if (!c) throw new Error("DockItem must sit inside a Dock");
  return c;
}

export type DockProps = {
  children: ReactNode;
  /** Accessible name of the toolbar, for example "Primary". */
  label: string;
  className?: string;
  /** Icon size under the pointer, px. Rest size is 44. */
  magnification?: number;
  /** How far (px) from the pointer an icon still grows a little. */
  distance?: number;
};

/** The panel. Children are DockItem and DockSeparator. */
export function Dock({ children, label, className, magnification = 64, distance = 140 }: DockProps) {
  const mouseX = useMotionValue(Infinity);
  const still = !!useReducedMotion();
  // One shared-layout id per dock, so the lime fill glides from the old item to the new one (not between two docks).
  const fillId = useId();
  const onMove = (e: ReactMouseEvent<HTMLElement>) => mouseX.set(e.clientX);
  const onLeave = () => mouseX.set(Infinity);
  return (
    <nav
      aria-label={label}
      onMouseMove={still ? undefined : onMove}
      onMouseLeave={still ? undefined : onLeave}
      className={cn("lg-glass dock flex items-end gap-1 rounded-[24px] px-2 pb-2 pt-2", className)}
      style={{ height: REST + 16 }}
    >
      <DockContext.Provider value={{ mouseX, magnification: still ? REST : magnification, distance, still, fillId }}>{children}</DockContext.Provider>
    </nav>
  );
}

export type DockItemProps = {
  /** Shown above the icon on hover and focus, and read by screen readers. */
  label: string;
  children: ReactNode;
  href?: string;
  onClick?: (e: ReactMouseEvent<HTMLElement>) => void;
  /** The destination you are on: a solid lime fill under a dark icon. Links also get aria-current="page". */
  active?: boolean;
  /** A small count or dot in the corner (unread notices, pending approvals). */
  badge?: ReactNode;
  className?: string;
  /** Extra attributes for the link or button (aria-haspopup, aria-expanded, data-*). */
  attrs?: Record<string, string | boolean | undefined>;
  prefetch?: boolean;
};

/** One icon in the dock: a link when `href` is given, otherwise a button. */
export function DockItem({ label, children, href, onClick, active, badge, className, attrs, prefetch }: DockItemProps) {
  const { mouseX, magnification, distance, still, fillId } = useDockCtx();
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const tipId = useId();

  const fromPointer = useTransform(mouseX, (x) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !Number.isFinite(x)) return Infinity;
    return x - r.left - r.width / 2;
  });
  const target = useTransform(fromPointer, [-distance, 0, distance], [REST, magnification, REST]);
  const width = useSpring(target, SPRING_DOCK);
  const iconSize = useTransform(width, (w) => Math.round(w * 0.5));

  // A hover that ends while the spring is still mid-flight must not leave a label standing.
  useEffect(() => {
    if (!hover) return;
    const off = () => setHover(false);
    window.addEventListener("scroll", off, { passive: true });
    return () => window.removeEventListener("scroll", off);
  }, [hover]);

  const show = hover || focus;
  const inner = (
    <>
      {active && <motion.span layoutId={still ? undefined : fillId} transition={T.nav} aria-hidden="true" className="dock-fill nav-fill absolute inset-0 rounded-[16px]" />}
      <motion.span style={{ width: iconSize, height: iconSize }} className="dock-ic relative grid place-items-center [&>svg]:h-full [&>svg]:w-full" aria-hidden="true">
        {children}
      </motion.span>
      {badge != null && badge !== false && (
        <span className={cn("dock-badge absolute -right-0.5 -top-0.5 grid min-h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10.5px] font-semibold leading-none ring-2", active ? "bg-lime-foreground text-lime ring-lime" : "bg-lime text-lime-foreground ring-[hsl(var(--glass-solid))]")}>
          {badge}
        </span>
      )}
    </>
  );
  const common = {
    className: cn(
      "dock-btn relative grid h-full w-full place-items-center rounded-[16px] text-foreground/60 outline-none transition-colors duration-nav ease-out motion-reduce:transition-none hover:bg-foreground/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
      active && "text-lime-foreground hover:bg-transparent hover:text-lime-foreground",
      className,
    ),
    "aria-label": label,
    "aria-describedby": show ? tipId : undefined,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    onClick,
    ...attrs,
  };
  return (
    <motion.div ref={ref} style={{ width, height: REST }} className="dock-item relative flex shrink-0 items-end justify-center">
      <AnimatePresence>
        {show && (
          <motion.span
            id={tipId}
            role="tooltip"
            initial={still ? { opacity: 0 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0, transition: T.menu }}
            exit={still ? { opacity: 0, transition: T.fade } : { opacity: 0, y: 4, transition: T.menuExit }}
            className="dock-tip pointer-events-none absolute bottom-full left-1/2 mb-3 w-max max-w-[16rem] -translate-x-1/2 rounded-[12px] bg-foreground px-2.5 py-1.5 text-[12.5px] font-medium text-background shadow-md"
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
      {href ? (
        <Link href={href} prefetch={prefetch} aria-current={active ? "page" : undefined} {...common}>
          {inner}
        </Link>
      ) : (
        <button type="button" {...common}>
          {inner}
        </button>
      )}
    </motion.div>
  );
}

/** A thin vertical rule between groups. */
export function DockSeparator() {
  return <span role="separator" aria-orientation="vertical" className="dock-sep mx-1 h-7 w-px shrink-0 self-center bg-foreground/[0.12]" />;
}
