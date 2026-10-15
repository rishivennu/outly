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
  /** optional content between the text and the buttons (e.g. a softer alternative) */
  extra?: React.ReactNode;
  /** "wide" fits a small form (e.g. an email composer) */
  size?: "default" | "wide";
}

/**
 * Small glass confirmation for destructive actions. Radix gives it the focus
 * trap, Escape handling and aria-modal; the cancel button keeps initial focus.
 */
export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel, cancelLabel = "Keep it", busy, tone = "danger", onConfirm, extra, size = "default" }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[70] bg-foreground/35 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            {/* Centred by a grid wrapper, not translate classes: framer-motion writes its own inline
                transform for y/scale, which wiped -translate-x/-y and pushed the card off-screen on phones. */}
            <Dialog.Content asChild forceMount>
              <div
                className="fixed inset-0 z-[71] grid place-items-center overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
                data-lenis-prevent
                onPointerDown={(e) => { if (e.target === e.currentTarget && !busy) onOpenChange(false); }}
              >
                <motion.div
                  initial={{ opacity: 0, y: 20, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 460, damping: 36 }}
                  className={`glass-strong w-full ${size === "wide" ? "max-w-[580px]" : "max-w-[420px]"} rounded-[28px] p-5 sm:p-6`}
                >
                  <Dialog.Title className="text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">{title}</Dialog.Title>
                  <Dialog.Description className="mt-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">{body}</Dialog.Description>
                  {extra}
                  <div className="mt-6 flex flex-wrap-reverse gap-2">
                    <Dialog.Close asChild>
                      <Button variant="ghost" className="min-w-[8rem] flex-1" autoFocus>
                        {cancelLabel}
                      </Button>
                    </Dialog.Close>
                    <Button variant={tone} className="min-w-[8rem] flex-1" onClick={onConfirm} disabled={busy}>
                      {busy ? "Working…" : confirmLabel}
                    </Button>
                  </div>
                </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
