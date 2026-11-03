"use client";
import { forwardRef, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { api } from "@/lib/client/api";
import { forgetBillingCopies } from "@/lib/client/forget-billing";
import { cn } from "@/lib/utils";

/**
 * Sign out, asking first (1072). 1100: shared as a hook so the rail's logout button and the account menu's
 * "Log out" row open the same confirm. `ask(returnTo)` opens it; Cancel puts focus back on `returnTo`.
 */
export function useSignOut() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const back = useRef<HTMLElement | null>(null);
  const ask = (returnTo?: HTMLElement | null) => {
    back.current = returnTo ?? null;
    setOpen(true);
  };
  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o && !busy) requestAnimationFrame(() => back.current?.focus());
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
  const dialog = (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Sign out of Outlly?"
      body="You'll need your password or an email code to sign back in on this device. Scheduled posts still go out."
      confirmLabel={busy ? "Signing out…" : "Sign out"}
      cancelLabel="Stay signed in"
      tone="primary"
      busy={busy}
      onConfirm={out}
    />
  );
  return { ask, dialog };
}

/** Sidebar sign-out (1072), beside the notices bell. It sits one slot from the bell, so it asks first.
 *  1100: forwards its ref and props, so a tooltip can wrap it (the rail's logout). */
export const SignOutButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(function SignOutButton({ className, children, onClick, ...rest }, ref) {
  const btn = useRef<HTMLButtonElement | null>(null);
  const { ask, dialog } = useSignOut();
  return (
    <>
      <button
        ref={(el) => {
          btn.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        type="button"
        aria-label="Sign out"
        title={children ? undefined : "Sign out"}
        {...rest}
        onClick={(e) => {
          onClick?.(e);
          ask(btn.current);
        }}
        className={children ? className : cn("grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground", className)}
      >
        {children ?? <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />}
      </button>
      {dialog}
    </>
  );
});
