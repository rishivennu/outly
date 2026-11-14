"use client";
import { useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { PolicyPanel } from "./PolicyPanel";
import { SubscribersPanel } from "./SubscribersPanel";
import { RiskPanel } from "./RiskPanel";
import { TrialsPanel } from "./TrialsPanel";
import { EconomicsPanel } from "./EconomicsPanel";

const TABS = [["policy", "Policy"], ["subscribers", "Subscribers"], ["risk", "Risk flags"], ["trials", "Trials"], ["economics", "Economics"]] as const;
type Tab = (typeof TABS)[number][0];

export function SubscriptionsAdmin({ target, openFlags }: { target: number; openFlags: number }) {
  const [tab, setTab] = useState<Tab>("policy");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  function onKey(e: React.KeyboardEvent, i: number) {
    const k = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const to = e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : k ? (i + k + TABS.length) % TABS.length : -1;
    if (to < 0) return;
    e.preventDefault();
    setTab(TABS[to][0]);
    refs.current[to]?.focus();
  }
  return (
    <div>
      <div role="tablist" aria-label="Subscriptions sections" className="-mx-1 mb-5 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {TABS.map(([k, label], i) => {
          const on = tab === k;
          return (
            <button
              key={k}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="tab"
              id={`${id}-tab-${k}`}
              aria-selected={on}
              aria-controls={`${id}-panel`}
              tabIndex={on ? 0 : -1}
              onClick={() => setTab(k)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
                on ? "lime-bg" : "bg-secondary/60 text-muted-foreground hairline hover:text-foreground",
              )}
            >
              {label}
              {k === "risk" && openFlags > 0 && <span className="tabular rounded-full bg-foreground/[0.08] px-1.5 text-[11.5px]">{openFlags}<span className="sr-only"> open</span></span>}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`} className="min-w-0">
        {tab === "policy" && <PolicyPanel />}
        {tab === "subscribers" && <SubscribersPanel target={target} />}
        {tab === "risk" && <RiskPanel />}
        {tab === "trials" && <TrialsPanel />}
        {tab === "economics" && <EconomicsPanel />}
      </div>
    </div>
  );
}
