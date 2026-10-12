"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";

export function RefundButton({ id, amount, customer }: { id: string; amount: string; customer: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();
  async function go() {
    setBusy(true);
    try {
      await adminApi(`/api/admin/payments/${id}/refund`, { method: "POST", json: {} });
      toast(`Refunded ${amount} to ${customer}. They've been emailed.`, "ok");
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] text-muted-foreground hairline hover:bg-secondary hover:text-foreground" aria-label={`Refund ${amount} to ${customer}`}>
        <Undo2 className="h-3.5 w-3.5" aria-hidden /> Refund
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Refund ${amount}?`}
        body={`${customer} gets the full amount back on their original payment method and their paid plan ends now. This can't be undone.`}
        confirmLabel="Refund now"
        cancelLabel="Cancel"
        busy={busy}
        onConfirm={go}
      />
    </>
  );
}
