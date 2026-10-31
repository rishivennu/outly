"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { useToast } from "@/components/shared/Toast";
import type { DashboardStyle } from "@/lib/dashboard-config";
import { cn } from "@/lib/utils";

/** Classic / Analytics, only shown while the admin lets people pick (1080). The pick is this browser's. */
export function DashboardSwitch({ current, className }: { current: DashboardStyle; className?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<DashboardStyle | null>(null);
  const go = async (style: DashboardStyle) => {
    if (style === current || busy) return;
    setBusy(style);
    try {
      await api("/api/me/dashboard", { method: "POST", json: { style } });
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't switch the dashboard. Try again.", "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div role="radiogroup" aria-label="Dashboard style" className={cn("inline-flex h-11 items-center gap-0.5 rounded-2xl bg-secondary/60 p-1 hairline", className)}>
      {(["classic", "pulse"] as const).map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={s === current}
          disabled={busy !== null}
          onClick={() => void go(s)}
          className={cn("h-9 rounded-xl px-3 text-[13px] font-semibold outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring", s === current ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          {busy === s ? "Switching…" : s === "classic" ? "Classic" : "Analytics"}
        </button>
      ))}
    </div>
  );
}
