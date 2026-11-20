"use client";
import { Smartphone } from "lucide-react";
import { useInstallState } from "@/lib/pwa/install";
import { InstallOutllyButton } from "./InstallOutllyButton";

/** Settings > Appearance: the Install Outlly button, or "Outlly is installed" once the browser says it is. */
export function InstallSettingsCard() {
  const s = useInstallState();
  if (!s.ready) return null;
  return (
    <section className="glass rounded-[32px] p-6 sm:p-8" aria-labelledby="install-h">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-secondary/70 hairline" aria-hidden="true">
          <Smartphone className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="install-h" className="text-2xl font-semibold tracking-tight">Home Screen app</h2>
          <InstallOutllyButton layout="panel" showInstalled className="mt-3" />
        </div>
      </div>
    </section>
  );
}
