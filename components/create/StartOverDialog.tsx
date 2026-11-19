"use client";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { FX } from "@/lib/motion/tokens";
import { fmtBytes } from "@/lib/storage/quota-core";

/**
 * R1209 B: Start over never clears or deletes work on its own. It asks what to do with what is here: keep it as a
 * draft (the video, both captions, every platform's copy and settings stay, and so does the storage they use),
 * delete it for good after a second confirmation, or cancel and change nothing.
 */
export type StartOverBusy = "save" | "delete" | null;

/** What a permanent delete does to the account's figures, said before it is confirmed. Free never gets allowance back. */
export function deleteNote(x: { monthly: boolean; storage: boolean }): string | null {
  if (x.monthly && x.storage) return "Deleting it frees its storage. This month's upload allowance stays as it is: a delete never gives it back.";
  if (x.monthly) return "This month's upload allowance stays as it is: a delete never gives it back.";
  if (x.storage) return "Deleting it for good frees the storage it uses.";
  return null;
}

/** The line after a delete, from what the server says it freed (never a made-up number). */
export function deletedLine(r: { freedBytes?: number; pendingBytes?: number; refunded?: boolean } | null | undefined, monthly: boolean): string {
  const freed = Math.max(0, Number(r?.freedBytes ?? 0));
  // The bucket was slow to let go: the draft is gone and the file follows shortly. Its space is not claimed back yet.
  if (Math.max(0, Number(r?.pendingBytes ?? 0)) > 0) return monthly ? "Deleted. The video is still being cleared from storage. This month's upload allowance stays as it is." : "Deleted. The video is still being cleared from storage, so its space frees up shortly.";
  if (r?.refunded && freed > 0) return `Deleted. ${fmtBytes(freed)} of storage is free again.`;
  if (monthly) return "Deleted. This month's upload allowance stays as it is.";
  return "Deleted. You're starting fresh.";
}

/** A short message carried across the reload into the fresh Create (the toast would be lost with the old page). */
const FLASH_KEY = "outlly:create-flash";
export function flashNext(message: string) {
  try {
    sessionStorage.setItem(FLASH_KEY, message);
  } catch {
    /* private mode: the fresh page simply says nothing */
  }
}
export function takeFlash(): string | null {
  try {
    const m = sessionStorage.getItem(FLASH_KEY);
    if (m) sessionStorage.removeItem(FLASH_KEY);
    return m;
  } catch {
    return null;
  }
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  busy: StartOverBusy;
  error: string | null;
  /** Still uploading: a saved draft waits for the video to land. */
  uploading: boolean;
  /** What the account's plan counts, for the note before a delete. */
  quota: { monthly: boolean; storage: boolean };
  onSave: () => void;
  onDelete: () => void;
}

export function StartOverDialog({ open, onOpenChange, busy, error, uploading, quota, onSave, onDelete }: Props) {
  const [stage, setStage] = useState<"ask" | "confirm">("ask");
  useEffect(() => {
    if (!open) setStage("ask");
  }, [open]);
  const note = deleteNote(quota);
  const confirm = stage === "confirm";
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[70] bg-foreground/35 backdrop-blur-[3px]" {...FX.scrim} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <div
                className="fixed inset-0 z-[71] grid place-items-center overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
                data-lenis-prevent
                data-testid="start-over"
                data-stage={stage}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget && !busy) onOpenChange(false);
                }}
              >
                <motion.div {...FX.dialog} className="glass-strong w-full max-w-[440px] rounded-[28px] p-5 sm:p-6">
                  <Dialog.Title className="text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">{confirm ? "Delete this creation permanently?" : "Start a new creation?"}</Dialog.Title>
                  <Dialog.Description className="mt-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                    {confirm
                      ? "This will delete the selected draft and its associated uploaded media. The action cannot be undone."
                      : `You have an existing video and work in progress. What would you like to do with it?${uploading ? " A saved draft waits for the video to finish uploading." : ""}`}
                  </Dialog.Description>
                  {confirm && note && <p className="mt-3 rounded-2xl bg-secondary/60 px-3.5 py-2.5 text-[13px] leading-snug">{note}</p>}
                  {error && (
                    <p role="alert" className="mt-3 text-[13px] font-medium leading-snug text-[hsl(0_72%_38%)] dark:text-destructive [overflow-wrap:anywhere]">
                      {error}
                    </p>
                  )}
                  {confirm ? (
                    <div className="mt-6 flex flex-wrap-reverse gap-2">
                      <Button type="button" variant="ghost" className="min-w-[8rem] flex-1" autoFocus disabled={!!busy} onClick={() => setStage("ask")}>
                        Go back
                      </Button>
                      <Button type="button" variant="danger" className="min-w-[8rem] flex-1" disabled={!!busy} onClick={onDelete} data-start-over="delete-confirm">
                        {busy === "delete" ? "Deleting…" : "Delete permanently"}
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-6 grid gap-2">
                      <Button type="button" variant="primary" className="w-full" disabled={!!busy} onClick={onSave} data-start-over="save">
                        {busy === "save" ? "Saving…" : "Save as draft"}
                      </Button>
                      <Button type="button" variant="danger" className="w-full" disabled={!!busy} onClick={() => setStage("confirm")} data-start-over="delete">
                        Delete and start fresh
                      </Button>
                      <Dialog.Close asChild>
                        <Button type="button" variant="ghost" className="w-full" autoFocus disabled={!!busy} data-start-over="cancel">
                          Cancel
                        </Button>
                      </Dialog.Close>
                    </div>
                  )}
                </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
