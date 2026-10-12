"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";

/** Opens or closes every comparison group at once. Stays in sync when groups are toggled one by one. */
export function CmpExpandAll() {
  const ref = useRef<HTMLButtonElement>(null);
  const [allOpen, setAllOpen] = useState(false);

  useEffect(() => {
    const root = ref.current?.closest("[data-cmp]");
    if (!root) return;
    const sync = () => setAllOpen([...root.querySelectorAll<HTMLDetailsElement>("details[data-cmp-group]")].every((d) => d.open));
    sync();
    root.addEventListener("toggle", sync, true);
    return () => root.removeEventListener("toggle", sync, true);
  }, []);

  const flip = () => {
    const root = ref.current?.closest("[data-cmp]");
    root?.querySelectorAll<HTMLDetailsElement>("details[data-cmp-group]").forEach((d) => (d.open = !allOpen));
  };

  return (
    <button ref={ref} type="button" onClick={flip} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-semibold text-foreground/80 transition-colors hover:bg-foreground/[0.06] hover:text-foreground">
      {allOpen ? <ChevronsDownUp className="h-4 w-4" aria-hidden="true" /> : <ChevronsUpDown className="h-4 w-4" aria-hidden="true" />}
      {allOpen ? "Collapse all" : "Expand all"}
    </button>
  );
}
