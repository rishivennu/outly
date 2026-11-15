"use client";
import { forwardRef, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { api, ApiError } from "@/lib/client/api";
import { legacyDraftCount, openDrafts } from "@/lib/client/device-drafts";
import { forgetLocalCopies } from "@/lib/client/forget-billing";
import { useOnline } from "@/lib/client/use-online";
import { useToast } from "@/components/shared/Toast";
import { useMaybeUser } from "./UserContext";
import { cn } from "@/lib/utils";

/**
 * Sign out, asking first (1072). 1100: shared as a hook so the rail's logout button and the account menu's
 * "Log out" row open the same confirm. `ask(returnTo)` opens it; Cancel puts focus back on `returnTo`.
 */
export function useSignOut() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unsynced, setUnsynced] = useState(0);
  const back = useRef<HTMLElement | null>(null);
  const userId = useMaybeUser()?.id;
  const online = useOnline();
  const toast = useToast();
  const ask = (returnTo?: HTMLElement | null) => {
    back.current = returnTo ?? null;
    setUnsynced(0);
    setOpen(true);
    // Signing out deletes the drafts kept on this device (an older version's too), so say so when some never reached Outlly.
    if (userId)
      void Promise.all([openDrafts(userId).list(), legacyDraftCount()]).then(([all, older]) => setUnsynced(all.filter((d) => d.syncState !== "synced").length + older));
  };
  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o && !busy) requestAnimationFrame(() => back.current?.focus());
  };
  const out = async () => {
    setBusy(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (e) {
      // Still signed in (offline, server error, rate limit): the drafts on this device stay. A 401 means the session already ended.
      if (!(e instanceof ApiError && e.status === 401)) {
        setBusy(false);
        toast("Couldn't sign out. Check your connection and try again. Your drafts are still on this device.", "error");
        return;
      }
    }
    await forgetLocalCopies();
    window.location.href = "/login";
  };
  const stuck = !online && unsynced > 0;
  const dialog = (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Sign out of Outlly?"
      body={
        stuck
          ? `You're offline, and ${unsynced === 1 ? "1 draft on this device hasn't" : `${unsynced} drafts on this device haven't`} synced to Outlly yet. Sign out once you're back online, so ${unsynced === 1 ? "it isn't" : "they aren't"} lost.`
          : unsynced
          ? `${unsynced === 1 ? "1 draft on this device hasn't" : `${unsynced} drafts on this device haven't`} synced to Outlly yet, and signing out removes ${unsynced === 1 ? "it" : "them"} from this browser. Scheduled posts still go out.`
          : "You'll need your password or an email code to sign back in on this device. Scheduled posts still go out."
      }
      confirmLabel={busy ? "Signing out…" : "Sign out"}
      cancelLabel="Stay signed in"
      tone="primary"
      busy={busy}
      disabled={stuck}
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
