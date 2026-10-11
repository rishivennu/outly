"use client";
import { useEffect, useState } from "react";

let seen = false; // module scope: survives route changes, resets on a full reload

/**
 * Wraps a route segment (used from template.tsx, which remounts on every navigation).
 * The page settles in with a short rise and blur-clear while a three-layer water wave with
 * rolling crests sweeps up and splashes across the screen. The very first load gets neither, so nothing delays paint.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const [first] = useState(() => !seen);
  const [wave, setWave] = useState(!first);
  useEffect(() => {
    seen = true;
    if (!wave) return;
    const t = setTimeout(() => setWave(false), 1700);
    return () => clearTimeout(t);
  }, [wave]);
  return (
    <>
      <div className={first ? undefined : "page-in"}>{children}</div>
      {wave && (
        <div className="page-wave" aria-hidden="true">
          <div className="pw-sheet"><span className="pw-crest" /></div>
          <div className="pw-sheet"><span className="pw-crest" /></div>
          <div className="pw-sheet"><span className="pw-crest" /></div>
          <span className="pw-ripple" />
          <span className="pw-ripple" />
        </div>
      )}
    </>
  );
}
