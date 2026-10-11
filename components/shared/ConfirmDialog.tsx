"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  tone?: "danger" | "primary";
  onConfirm: () => void;
}

/**
 * Small glass confirmation for destructive actions. Radix gives it the focus
 * trap, Escape handling and aria-modal; the cancel button keeps initial focus.
 */
export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel, cancelLabel = "Keep it", busy, tone = "danger", onConfirm }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[70] bg-foreground/35 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 460, damping: 36 }}
                className="glass-strong fixed left-1/2 top-1/2 z-[71] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[28px] p-6"
              >
                <Dialog.Title className="text-lg font-semibold tracking-tight">{title}</Dialog.Title>
                <Dialog.Description className="mt-2 text-sm text-muted-foreground">{body}</Dialog.Description>
                <div className="mt-6 flex gap-2">
                  <Dialog.Close asChild>
                    <Button variant="ghost" className="flex-1" autoFocus>
                      {cancelLabel}
                    </Button>
                  </Dialog.Close>
                  <Button variant={tone} className="flex-1" onClick={onConfirm} disabled={busy}>
                    {busy ? "Working…" : confirmLabel}
                  </Button>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
