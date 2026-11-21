"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { API } from "./model";
import { useAction } from "./useAction";

export function Withdraw({ appRef }: { appRef: string }) {
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  return (
    <section id="withdraw" aria-labelledby="pp-wd-h" className="rounded-[24px] border border-foreground/[0.08] bg-card p-5 sm:p-6">
      <h2 id="pp-wd-h" className="text-[15px] font-semibold">Changed your mind?</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">You can withdraw this application. The team stops reviewing it, and you can apply again later.</p>
      <Button type="button" variant="danger" size="md" className="mt-4 w-full sm:w-auto" onClick={() => setOpen(true)}>
        Withdraw application
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => !busy && setOpen(o)}
        title="Withdraw this application?"
        body="The team stops reviewing it straight away. This cannot be undone, but you can send a new application later."
        confirmLabel="Withdraw"
        busy={busy}
        onConfirm={async () => {
          if (await run(API.withdraw(appRef), {}, "Application withdrawn.")) setOpen(false);
        }}
      />
    </section>
  );
}
