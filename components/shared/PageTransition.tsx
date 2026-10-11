"use client";
import { useEffect, useState } from "react";

let seen = false; // module scope: survives route changes, resets on a full reload

/**
 * Wraps a route segment (used from template.tsx, which remounts on every navigation).
 * The page settles in with a short rise and blur-clear while a translucent water sheet
 * sweeps up across the screen. The very first load gets neither, so nothing delays paint.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const [first] = useState(() => !seen);
  const [wave, setWave] = useState(!first);
  useEffect(() => {
    seen = true;
    if (!wave) return;
    const t = setTimeout(() => setWave(false), 1100);
    return () => clearTimeout(t);
  }, [wave]);
  return (
    <>
      <div className={first ? undefined : "page-in"}>{children}</div>
      {wave && (
        <div className="page-wave" aria-hidden="true">
          <i />
          <i />
        </div>
      )}
    </>
  );
}
