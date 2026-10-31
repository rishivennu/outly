"use client";
import { useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { api } from "@/lib/client/api";
import { forgetBillingCopies } from "@/lib/client/forget-billing";
import { cn } from "@/lib/utils";

/** Sidebar sign-out (1072), beside the notices bell. It sits one slot from the bell, so it asks first. */
export function SignOutButton({ className }: { className?: string }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  // Cancel puts focus back on this button, so keyboard users land where they were.
  const onOpenChange = (o: boolean) => {
    setAsk(o);
    if (!o && !busy) requestAnimationFrame(() => btn.current?.focus());
  };
  const out = async () => {
    setBusy(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      await forgetBillingCopies();
      window.location.href = "/login";
    }
  };
  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => setAsk(true)}
        aria-label="Sign out"
        title="Sign out"
        className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground", className)}
      >
        <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
      <ConfirmDialog
        open={ask}
        onOpenChange={onOpenChange}
        title="Sign out of Outlly?"
        body="You'll need your password or an email code to sign back in on this device. Scheduled posts still go out."
        confirmLabel={busy ? "Signing out…" : "Sign out"}
        cancelLabel="Stay signed in"
        tone="primary"
        busy={busy}
        onConfirm={out}
      />
    </>
  );
}
