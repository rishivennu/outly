"use client";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";

/**
 * One POST to the creator's own partnership API, then a server refresh so every card reads the new state.
 * A second press while one is in flight does nothing (double taps never send twice).
 */
export function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const run = useCallback(
    async (url: string, json: unknown, okText: string): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setBusy(true);
      try {
        await api(url, { method: "POST", json });
        toast(okText, "ok");
        router.refresh();
        return true;
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "That didn't go through. Check your connection and try again.", "error");
        return false;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [router, toast],
  );
  return { busy, run };
}
