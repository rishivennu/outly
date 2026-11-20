"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";

type One = { status: "done" | "retry" | "dead" };
type Many = { total: number; done: number; retry: number; dead: number; skipped: number };

const ONE_SAID: Record<One["status"], [string, "ok" | "info" | "error"]> = {
  done: ["Sent. It is out of the dead letters.", "ok"],
  retry: ["It failed again and is back in the queue for another try.", "info"],
  dead: ["It failed again and was given up on. The new reason is in the list.", "error"],
};

export function manySaid(r: Many): [string, "ok" | "info" | "error"] {
  const parts = [`${r.done} sent`, r.retry ? `${r.retry} back in the queue` : "", r.dead ? `${r.dead} given up on again` : "", r.skipped ? `${r.skipped} already gone` : ""].filter(Boolean);
  return [`Retried ${r.total}: ${parts.join(", ")}.`, !r.done && (r.dead || r.skipped) ? "error" : r.retry || r.dead || r.skipped ? "info" : "ok"];
}

/** One dead letter (`id`) or every row on screen (`ids`, the server caps it at 100). */
export function RetryButton({ id, ids, what }: { id?: string; ids?: string[]; what?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const all = !id;
  const label = all ? `Retry all shown (${ids?.length ?? 0})` : "Retry";

  async function run() {
    setBusy(true);
    try {
      if (id) {
        const r = await adminApi<One>("/api/admin/notifications/retry", { method: "POST", json: { id } });
        toast(...ONE_SAID[r.status]);
      } else {
        const r = await adminApi<Many>("/api/admin/notifications/retry", { method: "POST", json: { ids } });
        toast(...manySaid(r));
      }
      router.refresh();
    } catch (e: any) {
      toast(e?.message ?? "Couldn't retry it.", "error");
      if (e?.status === 404) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={all ? "subtle" : "outline"}
      className="min-h-11"
      disabled={busy || (all && !ids?.length)}
      aria-busy={busy}
      aria-label={all ? undefined : `Retry ${what ?? "this dead letter"}`}
      onClick={run}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
      {busy ? "Retrying" : label}
    </Button>
  );
}
