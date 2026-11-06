"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";

/** One row's Invite button (the table is server-rendered). Refreshes the page so the counts and the row update. */
export function InviteOne({ id, email }: { id: string; email: string }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="subtle"
      disabled={busy}
      aria-label={`Invite ${email}`}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await adminApi<{ invited: number }>("/api/admin/waitlist", { method: "POST", json: { ids: [id] } });
          toast(r.invited ? `Invite emailed to ${email}` : "Already invited");
          start(() => router.refresh());
        } catch (e) {
          toast((e as Error).message, "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Sending…" : "Invite"}
    </Button>
  );
}

/**
 * Keeps the waitlist page in step with the database: re-reads it every 30 s while the tab is visible and as soon as
 * the admin comes back to the tab, so a new join shows up in the count without a manual refresh.
 */
export function AutoRefresh({ every = 30_000 }: { every?: number }) {
  const router = useRouter();
  const [, start] = useTransition();
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && start(() => router.refresh());
    const t = setInterval(tick, every);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [every, router]);
  return null;
}
