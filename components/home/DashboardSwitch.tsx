"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api, ApiError } from "@/lib/client/api";
import { useToast } from "@/components/shared/Toast";
import type { DashboardStyle } from "@/lib/dashboard-config";
import { cn } from "@/lib/utils";

/** Classic / Analytics, only shown while the admin lets people pick (1080). The pick is this browser's. */
export function DashboardSwitch({ current, className }: { current: DashboardStyle; className?: string }) {
  const router = useRouter();
  const toast = useToast();
  // 1154: the pick shows the moment you tap it, and the new dashboard is swapped in place (a server refresh,
  // no page load, scroll and the shell kept). A failed save puts the pick back and says why.
  const [picked, setPicked] = useState<DashboardStyle>(current);
  const [saving, setSaving] = useState(false);
  const [swapping, start] = useTransition();
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    setPicked(current);
  }
  const busy = saving || swapping;
  const go = async (style: DashboardStyle) => {
    if (style === picked || busy) return;
    setPicked(style);
    setSaving(true);
    try {
      await api("/api/me/dashboard", { method: "POST", json: { style } });
      start(() => router.refresh());
    } catch (e) {
      setPicked(current);
      toast(e instanceof ApiError ? e.message : "Couldn't switch the dashboard. Try again.", "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div role="radiogroup" aria-label="Dashboard style" aria-busy={busy} className={cn("inline-flex items-center gap-0.5 rounded-2xl bg-secondary/60 p-[3px] hairline", className)}>
      {(["classic", "pulse"] as const).map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={s === picked}
          aria-disabled={busy || undefined}
          onClick={() => void go(s)}
          className={cn("relative h-11 flex-1 whitespace-nowrap rounded-[13px] px-3.5 text-[13px] font-semibold outline-none transition-[color,background-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.96] motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring", s === picked ? "lime-bg shadow-[inset_0_1px_0_hsl(0_0%_100%/0.45),0_6px_16px_-8px_hsl(var(--lime)/0.75)]" : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground", busy && s === picked && "animate-pulse motion-reduce:animate-none")}
        >
          {s === "classic" ? "Classic" : "Analytics"}
        </button>
      ))}
    </div>
  );
}
