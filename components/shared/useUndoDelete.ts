"use client";
import { useCallback, useEffect, useRef } from "react";
import { useToast, useToastDismiss } from "@/components/shared/Toast";
import { deferredQueue, type DeferredJob, type DeferredQueue } from "@/lib/client/deferred-delete";

export const UNDO_MS = 6000;

/**
 * 1148: `later(key, job)` hides nothing itself: the caller has already taken the item off screen. It shows
 * "Deleted." with Undo for UNDO_MS, sends the delete when that toast goes, and puts the item back on Undo or
 * when the delete fails. Closing the tab sends what is pending (keepalive); leaving the page inside the app
 * closes the toasts, which sends them the normal way.
 */
export function useUndoDelete() {
  const toast = useToast();
  const dismiss = useToastDismiss();
  const q = useRef<DeferredQueue | null>(null);
  q.current ??= deferredQueue();
  const open = useRef(new Map<string, number>());

  useEffect(() => {
    const queue = q.current!;
    const ids = open.current;
    const flush = () => queue.flushAll();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      for (const id of [...ids.values()]) dismiss(id);
    };
  }, [dismiss]);

  return useCallback(
    (key: string, job: DeferredJob, message = "Deleted.") => {
      const queue = q.current!;
      // The same item deleted again while its toast is up: that toast goes first, sending the earlier delete.
      const before = open.current.get(key);
      if (before !== undefined) dismiss(before);
      queue.add(key, job);
      const id = toast(message, "info", {
        duration: UNDO_MS,
        action: { label: "Undo", onClick: () => queue.undo(key) },
        onClose: (reason) => {
          if (open.current.get(key) !== id) return;
          open.current.delete(key);
          if (reason !== "action") void queue.commit(key);
        },
      });
      open.current.set(key, id);
    },
    [toast, dismiss],
  );
}
