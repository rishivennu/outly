"use client";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { openPalette } from "./CommandPalette";

/** Sidebar way in to the command palette, showing the shortcut so people learn it. */
export function PaletteButton({ compact = false }: { compact?: boolean }) {
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)), []);
  const key = mac ? "Cmd K" : "Ctrl K";
  if (compact)
    return (
      <button type="button" onClick={openPalette} aria-label="Search or jump" className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
        <Search className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
    );
  return (
    <button
      type="button"
      onClick={openPalette}
      aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
      className="mb-6 flex h-11 items-center gap-2.5 rounded-2xl px-3 text-[13.5px] text-muted-foreground transition-colors hairline hover:bg-foreground/[0.04] hover:text-foreground"
    >
      <Search className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
      <span className="flex-1 text-left">Search or jump</span>
      <kbd className="rounded-md px-1.5 py-0.5 text-[11px] font-medium hairline" aria-hidden="true">{key}</kbd>
    </button>
  );
}
