"use client";
import { useState } from "react";
import { ArrowLeft, Users } from "lucide-react";
import { useUser } from "./UserContext";
import { api } from "@/lib/client/api";

/** Shown on every studio page while you're working inside someone else's workspace. */
export function WorkspaceBar() {
  const { workspace } = useUser();
  const [busy, setBusy] = useState(false);
  if (!workspace) return null;
  const back = async () => {
    setBusy(true);
    try {
      await api("/api/team/switch", { method: "POST", json: { ownerId: null } });
    } finally {
      window.location.href = "/home";
    }
  };
  return (
    <div role="status" className="relative z-30 flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-secondary/90 px-5 py-2 text-sm backdrop-blur sm:px-10">
      <p className="flex min-w-0 items-center gap-2">
        <Users className="h-4 w-4 shrink-0 text-lime-ink" aria-hidden="true" />
        <span className="truncate">
          You're in <b>{workspace.ownerName}</b>'s studio as {workspace.role === "manager" ? "a manager" : "an editor"}.
        </span>
      </p>
      <button type="button" onClick={back} disabled={busy} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 font-medium hover:bg-foreground/[0.06] focus-visible:outline-2 disabled:opacity-60">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {busy ? "Switching…" : "Back to my studio"}
      </button>
    </div>
  );
}
