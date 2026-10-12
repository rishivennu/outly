"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/client/api";

export function AcceptInvite({ token, owner }: { token: string; owner: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/team/accept", { method: "POST", json: { token } });
      window.location.href = "/home";
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something got in the way.");
      setBusy(false);
    }
  };
  return (
    <div className="mt-8 flex flex-col items-center gap-3">
      <Button variant="lime" size="lg" onClick={go} disabled={busy}>
        {busy ? "Joining…" : `Join ${owner}'s studio`}
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
