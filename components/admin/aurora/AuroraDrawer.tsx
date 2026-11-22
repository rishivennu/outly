"use client";
import Link from "next/link";
import { useEffect, type RefObject } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronRight, LogOut, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { OrbAvatar } from "@/components/brand/OrbAvatar";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { ContrastToggle } from "@/components/shared/ContrastToggle";
import { Button } from "@/components/ui/button";
import { FX, T } from "@/lib/motion/tokens";
import { ROLE_LABEL, type AdminRole } from "@/lib/admin/perms";
import { active } from "@/components/admin/AdminShell";
import { DesignSwitch } from "./DesignSwitch";
import { ACCOUNT_HREF, badgeText, countFor, isAccount, type Badges, type VisibleGroup } from "./AuroraNav";

/** A short rise plus fade on the menu time, out quicker than in; reduced motion is a plain fade. */
const SHEET_FX = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0, transition: T.menu },
  exit: { opacity: 0, y: 16, transition: T.menuExit },
};

const RING = "outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The phone and tablet navigation: a bottom sheet on phones, a centred sheet on tablets. Radix gives the focus trap,
 * Escape, outside tap and the scroll lock; framer only animates. Focus goes back to `returnFocus` when it closes.
 */
export function AuroraDrawer({ open, onOpenChange, admin, path, groups, badges, returnFocus }: { open: boolean; onOpenChange: (open: boolean) => void; admin: { name: string; role: AdminRole }; path: string; groups: VisibleGroup[]; badges: Badges; returnFocus?: RefObject<HTMLElement | null> }) {
  const reduce = useReducedMotion();
  const close = () => onOpenChange(false);
  const mine = isAccount(path);

  // Rotating a tablet past the desktop breakpoint brings the pills back; never leave an invisible modal behind.
  useEffect(() => {
    if (!open) return;
    const mq = matchMedia("(min-width: 1024px)");
    const off = () => mq.matches && onOpenChange(false);
    mq.addEventListener("change", off);
    return () => mq.removeEventListener("change", off);
  }, [open, onOpenChange]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <div className="admin-layer aurora">
              <Dialog.Overlay asChild forceMount>
                <motion.div className="au-sheet-overlay fixed inset-0 z-[var(--admin-z-drawer)] bg-foreground/40 backdrop-blur-[3px] lg:hidden" {...(reduce ? FX.fade : FX.scrim)} />
              </Dialog.Overlay>
              <Dialog.Content
                asChild
                forceMount
                aria-describedby={undefined}
                onCloseAutoFocus={(e) => {
                  if (!returnFocus?.current) return;
                  e.preventDefault();
                  returnFocus.current.focus({ preventScroll: true });
                }}
              >
                <motion.div
                  className="au-sheet fixed inset-x-0 bottom-0 z-[var(--admin-z-drawer)] mx-auto flex max-h-[min(88dvh,calc(100dvh-var(--sa-t)-1rem))] w-full flex-col overflow-hidden rounded-t-[28px] pb-[var(--sa-b)] outline-none md:bottom-auto md:top-[max(6dvh,calc(var(--sa-t)+1rem))] md:max-h-[80dvh] md:w-[min(560px,calc(100vw-3rem))] md:rounded-[28px] md:pb-0 lg:hidden"
                  {...(reduce ? FX.fade : SHEET_FX)}
                >
                  <div className="relative flex items-center justify-center px-4 pb-1 pt-2.5">
                    <span className="au-sheet-handle h-1.5 w-10 rounded-full md:hidden" aria-hidden />
                    <Dialog.Title className="sr-only">Navigation</Dialog.Title>
                    <Dialog.Close asChild>
                      <Button type="button" variant="ghost" size="icon" aria-label="Close navigation" className={cn("absolute right-2 top-1", RING)}>
                        <X className="h-5 w-5" aria-hidden />
                      </Button>
                    </Dialog.Close>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 pt-8 md:pt-10" data-lenis-prevent="">
                    <nav aria-label="Sections" className="flex flex-col gap-4">
                      {groups.map((g) => (
                        <section key={g.group} aria-labelledby={`au-sheet-${g.group.replace(/\s+/g, "-")}`}>
                          <h2 id={`au-sheet-${g.group.replace(/\s+/g, "-")}`} className="au-sheet-group mb-1 px-3 text-[12px] font-semibold tracking-[0.02em]">
                            {g.group}
                          </h2>
                          <ul className="grid grid-cols-1 gap-0.5 md:grid-cols-2">
                            {g.items.map(({ href, label, icon: Icon, area }) => {
                              const on = active(path, href);
                              const n = countFor(area, badges);
                              return (
                                <li key={href}>
                                  <Link href={href} onClick={close} aria-current={on ? "page" : undefined} aria-label={n > 0 ? `${label}, ${n} open` : undefined} className={cn("au-sheet-link flex min-h-11 items-center gap-3 rounded-2xl px-3 text-[15px] font-medium", RING, "focus-visible:ring-inset")}>
                                    <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={on ? 2.2 : 1.8} aria-hidden />
                                    <span className="min-w-0 flex-1 truncate">{label}</span>
                                    {n > 0 && (
                                      <span className="au-pill-badge grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold tabular" aria-hidden>
                                        {badgeText(n)}
                                      </span>
                                    )}
                                  </Link>
                                </li>
                              );
                            })}
                          </ul>
                        </section>
                      ))}
                    </nav>
                  </div>

                  <div className="flex flex-col gap-2 border-t border-border/60 px-3 pb-3 pt-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <ThemeToggle compact plain />
                      <ContrastToggle className={cn("min-h-11", RING)} />
                      <DesignSwitch current="aurora" label className="ml-auto" />
                    </div>
                    <div className="flex items-center gap-1">
                      <Link href={ACCOUNT_HREF} onClick={close} aria-current={mine ? "page" : undefined} className={cn("au-sheet-link flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-2xl px-2", RING, "focus-visible:ring-inset")}>
                        <OrbAvatar seed={admin.name} size={34} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-semibold">{admin.name}</span>
                          <span className="block truncate text-[12px] text-muted-foreground">{ROLE_LABEL[admin.role]}, my account</span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      </Link>
                      <form action="/api/admin/logout" method="post" className="shrink-0">
                        <Button type="submit" variant="ghost" size="icon" aria-label="Sign out" className={RING}>
                          <LogOut className="h-4 w-4" aria-hidden />
                        </Button>
                      </form>
                    </div>
                  </div>
                </motion.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
