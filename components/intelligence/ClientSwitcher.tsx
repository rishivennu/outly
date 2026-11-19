"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { useUser } from "@/components/shell/UserContext";
import { CLIENT_NOTE, clientOptions, pickClient, type ClientOption, type ClientProfile } from "./view-core";

/**
 * R1243: agency client views. Owner only (members never see the owner's client list, and the profiles route is
 * owner-only too). Hidden when the owner has no client profiles, so a creator never sees an empty control.
 */
export function ClientSwitcher({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  const { workspace } = useUser();
  const owner = !workspace;
  const [options, setOptions] = useState<ClientOption[] | null>(null);

  useEffect(() => {
    if (!owner) return;
    let live = true;
    api<{ profiles: ClientProfile[] }>("/api/settings/brand/profiles")
      .then((r) => live && setOptions(clientOptions(r.profiles)))
      .catch(() => live && setOptions(null));
    return () => {
      live = false;
    };
  }, [owner]);

  if (!owner || !options) return null;
  return (
    <div className="grid gap-1.5">
      <label htmlFor="intel-client" className="text-sm font-medium">
        Client
      </label>
      <select id="intel-client" value={pickClient(options, value)} onChange={(e) => onChange(pickClient(options, e.target.value))} className="h-11 w-full max-w-xs rounded-2xl bg-secondary/50 px-3 text-[14px] hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
        {options.map((o) => (
          <option key={o.key || "own"} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      <p className="max-w-2xl text-[13px] text-muted-foreground">{CLIENT_NOTE}</p>
    </div>
  );
}
