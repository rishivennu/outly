"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Database, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { DragToConfirm } from "@/components/ui/easy/DragToConfirm";
import { adminApi } from "@/lib/client/admin-api";

export function SampleData({ hasSample }: { hasSample: boolean }) {
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const trigger = useRef<HTMLButtonElement>(null);
  const confirmBox = useRef<HTMLDivElement>(null);
  // Opening the slider moves focus onto its thumb; Keep it (or Escape) brings focus back to the button.
  const back = useRef(false);
  useEffect(() => {
    if (ask) confirmBox.current?.querySelector<HTMLElement>('[role="slider"]')?.focus();
    else if (back.current) trigger.current?.focus();
    back.current = false;
  }, [ask]);
  const cancel = () => {
    back.current = true;
    setAsk(false);
  };
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
  if (!hasSample) return <Button variant="subtle" size="sm" onClick={() => run("POST")} disabled={busy}><Database className="h-4 w-4" aria-hidden />{busy ? "Loading…" : "Load sample data"}</Button>;
  // R1288: clearing is a slide (EasyUI DragToConfirm) instead of a dialog; Enter or Space on the thumb does the same.
  return ask ? (
    <div ref={confirmBox} role="group" aria-labelledby="sample-clear-note" onKeyDown={(e) => e.key === "Escape" && !busy && cancel()} className="flex w-full max-w-md flex-col gap-2">
      <p id="sample-clear-note" className="text-[12.5px] text-muted-foreground">Clear sample data? Removes the 64 sample users and their payments, invoices and tickets. Real data is not touched.</p>
      <div className="flex items-center gap-2">
        <DragToConfirm actionType="delete" label="Slide to clear sample data" confirmedLabel="Clearing" autoResetDelay={0} disabled={busy} onConfirm={() => run("DELETE")} className="min-w-0 flex-1" />
        <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={busy}>Keep it</Button>
      </div>
    </div>
  ) : (
    <Button ref={trigger} variant="outline" size="sm" onClick={() => setAsk(true)} disabled={busy}><Trash2 className="h-4 w-4" aria-hidden />Clear sample data</Button>
  );
}
