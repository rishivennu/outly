import { BadgeCheck, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrustBadges as T } from "@/lib/badges-core";

/** Founding Member and Verified Manager pills. Renders nothing when neither is earned. */
export function TrustBadges({ b, className }: { b: T; className?: string }) {
  if (!b.foundingNo && !b.verifiedManager) return null;
  return (
    <ul className={cn("flex flex-wrap items-center gap-2", className)} aria-label="Badges">
      {b.verifiedManager && (
        <li className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[hsl(var(--lime))] px-3 text-sm font-semibold text-[hsl(var(--lime-foreground))]" title="On the Pro plan, email proven, managing two or more accounts">
          <BadgeCheck className="h-4 w-4" aria-hidden="true" /> Verified Manager
        </li>
      )}
      {b.foundingNo && (
        <li className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-semibold hairline">
          <Rocket className="h-4 w-4" aria-hidden="true" /> Founding Member #{b.foundingNo}
        </li>
      )}
    </ul>
  );
}
