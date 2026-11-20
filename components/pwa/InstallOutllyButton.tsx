"use client";
import { useId, useState } from "react";
import { CircleCheck, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { installManager, useInstallState, type InstallSnapshot } from "@/lib/pwa/install";

export const INSTALL_LABEL = "Install Outlly";
export const INSTALL_TEXT = "Get faster access to Outlly directly from your Home Screen.";

export type InstallResult = "accepted" | "dismissed" | "guide";

/** Nothing to install: already installed, or the native prompt was accepted and the browser is finishing. */
export const installHidden = (s: InstallSnapshot) => !s.ready || s.installed || s.outcome === "accepted";

/**
 * R1256: the one Install Outlly button. With the browser's prompt in hand (Android Chrome, Edge, desktop Chrome)
 * a click opens that prompt and waits for the answer; anywhere else (iPhone, iPad, browsers without the prompt) it
 * opens the step-by-step guide, which is the only honest way to install there. Installed is only shown once the
 * browser says so. `layout`: "panel" for Settings, "menu" for the account menu and phone drawer, "card" inside the
 * Home Screen card (which shows the supporting text itself).
 */
export function InstallOutllyButton({
  layout = "panel",
  className,
  onPick,
  onResult,
  describedBy,
  showInstalled = false,
}: {
  layout?: "panel" | "menu" | "card";
  className?: string;
  /** Runs before anything opens (the account menu closes itself here). */
  onPick?: () => void;
  onResult?: (r: InstallResult) => void;
  describedBy?: string;
  /** Settings: say "Outlly is installed" instead of disappearing. */
  showInstalled?: boolean;
}) {
  const s = useInstallState();
  const [busy, setBusy] = useState(false);
  const textId = useId();

  if (!s.ready) return null;

  if (s.installed || s.outcome === "accepted") {
    if (!showInstalled && !s.justInstalled && s.outcome !== "accepted") return null;
    const done = s.installed;
    return (
      <p role="status" className={cn("flex items-start gap-2.5 text-[14px] leading-snug", layout === "menu" && "px-3 py-2", className)}>
        <CircleCheck className="mt-0.5 h-[18px] w-[18px] shrink-0 text-lime-ink" aria-hidden="true" />
        <span>
          <span className="block font-semibold text-foreground">{done ? "Outlly is installed" : "Installing Outlly\u2026"}</span>
          <span className="block text-muted-foreground">
            {s.standalone ? "You are using the installed app." : done ? "Open it from your Home Screen or app list." : "Your browser is adding it now."}
            {!s.standalone && s.platform !== "ios" && " It shares this browser\u2019s sign-in."}
          </span>
        </span>
      </p>
    );
  }

  const click = async () => {
    onPick?.();
    const m = installManager();
    if (!m) return;
    if (!s.canPrompt) {
      m.openGuide();
      onResult?.("guide");
      return;
    }
    setBusy(true);
    const r = await m.promptInstall();
    setBusy(false);
    if (r === "unavailable") {
      // The browser took its prompt back (or it would not open): its own menu still works, so show that way.
      m.openGuide();
      onResult?.("guide");
    } else onResult?.(r);
  };

  const describe = describedBy ?? (layout === "card" ? undefined : textId);
  const button = (
    <Button
      variant="lime"
      size="md"
      data-mi={layout === "menu" ? "" : undefined}
      className={cn("w-full", layout === "panel" && "sm:w-auto")}
      onClick={() => void click()}
      disabled={busy}
      aria-describedby={describe}
      aria-haspopup={s.canPrompt ? undefined : "dialog"}
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      {busy ? "Opening\u2026" : INSTALL_LABEL}
    </Button>
  );
  if (layout === "card") return <div className={className}>{button}</div>;
  if (layout === "menu")
    return (
      <div className={cn("px-1.5 py-1.5", className)}>
        {button}
        <p id={textId} className="mt-1.5 px-1.5 text-[12px] leading-snug text-muted-foreground">{INSTALL_TEXT}</p>
      </div>
    );
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", className)}>
      <p id={textId} className="text-sm text-muted-foreground">{INSTALL_TEXT}</p>
      {button}
    </div>
  );
}
