"use client";
import { useEffect, useState } from "react";
import { Contrast } from "lucide-react";
import { CONTRAST_KEY } from "@/lib/theme/script";
import { cn } from "@/lib/utils";

/** High-contrast switch: stronger text, borders and focus rings. Saved per browser, applied before paint. */
export function ContrastToggle({ className, label = true }: { className?: string; label?: boolean }) {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(document.documentElement.dataset.contrast === "more"), []);
  const toggle = () => {
    const next = !on;
    setOn(next);
    if (next) {
      document.documentElement.dataset.contrast = "more";
      localStorage.setItem(CONTRAST_KEY, "more");
    } else {
      delete document.documentElement.dataset.contrast;
      localStorage.removeItem(CONTRAST_KEY);
    }
  };
  return (
    <button type="button" role="switch" aria-checked={on} onClick={toggle} title="High contrast" aria-label={label ? undefined : "High contrast"} className={cn("inline-flex h-10 items-center gap-2 rounded-full px-3 text-[13px] transition-colors", on ? "bg-foreground text-background" : "text-muted-foreground hover:bg-secondary hover:text-foreground", className)}>
      <Contrast className="h-4 w-4" aria-hidden />
      {label && <span>High contrast</span>}
    </button>
  );
}
