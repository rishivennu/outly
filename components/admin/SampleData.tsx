"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Database, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { adminApi } from "@/lib/client/admin-api";

export function SampleData({ hasSample }: { hasSample: boolean }) {
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const run = async (method: "POST" | "DELETE") => {
    setBusy(true);
    try {
      await adminApi("/api/admin/sample", { method });
      toast(method === "POST" ? "Sample data loaded" : "Sample data cleared");
      router.refresh();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
      setAsk(false);
    }
  };
  return hasSample ? (
    <>
      <Button variant="outline" size="sm" onClick={() => setAsk(true)} disabled={busy}><Trash2 className="h-4 w-4" aria-hidden />Clear sample data</Button>
      <ConfirmDialog open={ask} onOpenChange={setAsk} title="Clear sample data?" body="Removes the 64 sample users and their payments, invoices and tickets. Real data is not touched." confirmLabel="Clear it" busy={busy} onConfirm={() => run("DELETE")} />
    </>
  ) : (
    <Button variant="subtle" size="sm" onClick={() => run("POST")} disabled={busy}><Database className="h-4 w-4" aria-hidden />{busy ? "Loading…" : "Load sample data"}</Button>
  );
}
