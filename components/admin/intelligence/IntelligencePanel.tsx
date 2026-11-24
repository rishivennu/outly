"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/admin/ui";
import { adminApi } from "@/lib/client/admin-api";

/**
 * R1324: the two actions on the Intelligence governance page. Rebuild the shared baselines now, and move a model
 * version between candidate / active / retired. Both post to /api/admin/intelligence and refresh the page.
 */

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error && e.message ? e.message : "That didn't go through.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function RebuildButton() {
  const { busy, error, run } = useRun();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => run(() => adminApi("/api/admin/intelligence", { method: "POST", json: { action: "rebuild" } }))}>
        {busy ? "Rebuilding…" : "Rebuild shared baselines now"}
      </Button>
      {error && <span role="alert" className="text-[12px] text-destructive">{error}</span>}
    </span>
  );
}

const NEXT: Record<string, { to: "candidate" | "active" | "retired"; label: string }[]> = {
  candidate: [{ to: "active", label: "Activate" }, { to: "retired", label: "Retire" }],
  active: [{ to: "retired", label: "Retire" }],
  retired: [{ to: "candidate", label: "Bring back as candidate" }],
};

export function VersionActions({ version, locked }: { version: { key: string; status: string }; locked: boolean }) {
  const { busy, error, run } = useRun();
  const tone = version.status === "active" ? "ok" : version.status === "retired" ? "muted" : "info";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Pill tone={tone}>{version.status}</Pill>
      {!locked && (NEXT[version.status] ?? []).map((n) => (
        <Button key={n.to} type="button" variant="ghost" size="sm" disabled={busy} onClick={() => run(() => adminApi("/api/admin/intelligence", { method: "POST", json: { action: "status", key: version.key, status: n.to } }))}>
          {n.label}
        </Button>
      ))}
      {locked && <span className="text-[12px] text-muted-foreground">The active scorer; ship a replacement before retiring it.</span>}
      {error && <span role="alert" className="text-[12px] text-destructive">{error}</span>}
    </div>
  );
}
