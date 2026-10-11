"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One floating surface: bottom sheet on mobile, floating side panel on desktop.
 * Radix handles focus trap, Escape, and aria-modal.
 */
export function Sheet({ open, onOpenChange, title, description, children, side = "right", className }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: React.ReactNode; side?: "right" | "center"; className?: string }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[60] bg-foreground/40 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={description ? undefined : undefined}>
              <motion.div
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 30 }}
                transition={{ type: "spring", stiffness: 420, damping: 38 }}
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.6 }}
                onDragEnd={(_, i) => {
                  if (i.offset.y > 120 && window.innerWidth < 1024) onOpenChange(false);
                }}
                className={cn(
                  "glass-strong fixed z-[61] flex max-h-[88dvh] flex-col overflow-hidden",
                  "inset-x-0 bottom-0 rounded-t-[32px] pb-[env(safe-area-inset-bottom)]",
                  side === "right" ? "lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-4 lg:max-h-none lg:w-[440px] lg:rounded-[32px]" : "lg:inset-x-0 lg:bottom-auto lg:top-[8dvh] lg:mx-auto lg:w-[560px] lg:rounded-[32px]",
                  className,
                )}
              >
                <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-foreground/25 lg:hidden" aria-hidden="true" />
                <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-4 lg:pt-6">
                  <div>
                    <Dialog.Title className="text-lg font-semibold tracking-tight">{title}</Dialog.Title>
                    {description && <Dialog.Description className="mt-0.5 text-sm text-muted-foreground">{description}</Dialog.Description>}
                  </div>
                  <Dialog.Close className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Close">
                    <X className="h-5 w-5" />
                  </Dialog.Close>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
