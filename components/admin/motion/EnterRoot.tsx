"use client";
import { useEnter } from "@/components/dashboard/motion";
import { cn } from "@/lib/utils";

/**
 * The analytics entrance for admin pages (1081): every [data-enter] inside rises and fades in, staggered,
 * the first time the root is on screen, and RollingNumbers inside roll up with it. Server pages mark their
 * own blocks with data-enter, so this is the only client piece they need. Reduced motion: a cross-fade.
 */
export function EnterRoot({ children, className }: { children: React.ReactNode; className?: string }) {
  const { root } = useEnter<HTMLDivElement>();
  return (
    <div ref={root} data-enter-root className={cn(className)}>
      {children}
    </div>
  );
}
