"use client";
import { useRef } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuroraEnter } from "./motion";

/**
 * R1304: the client wrapper an Aurora server composition renders around its cards. Every [data-aurora="card"]
 * inside rises and fades in with a stagger, and every [data-aurora="count"] counts up to its data-count, once
 * per route. Server components mark their own blocks; this is the only client piece they need.
 */
export function AuroraStage({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const path = usePathname();
  useAuroraEnter(ref, [path]);
  return (
    <div ref={ref} data-aurora-stage className={cn(className)}>
      {children}
    </div>
  );
}
