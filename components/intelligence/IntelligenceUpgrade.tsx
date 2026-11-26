import Link from "next/link";
import { UPGRADE_COPY } from "@/lib/intelligence/entitlements-core";
import { Card } from "./bits";
import { SharingRow } from "./SharingRow";

/**
 * R1334: what a creator without the Personal Intelligence perk sees where the personal layer would be. Plain words
 * about what the engine does and where it is turned on; no locked cards, no numbers "generated for you". The shared
 * learning switch stays here because consent is theirs on every plan.
 */
export function IntelligenceUpgrade({ planName, client }: { planName: string; client: string | null }) {
  return (
    <Card id="intel-upgrade" title={UPGRADE_COPY.title} desc={`Not part of ${planName}.`}>
      <p className="text-sm leading-relaxed text-muted-foreground">{UPGRADE_COPY.body}</p>
      <ul className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-muted-foreground">
        {UPGRADE_COPY.points.map((p) => (
          <li key={p} className="flex gap-2"><span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />{p}</li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] text-muted-foreground">{UPGRADE_COPY.note}</p>
      <Link href="/billing" className="mt-4 inline-flex min-h-11 items-center rounded-full bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">See plans</Link>
      {!client && <SharingRow />}
    </Card>
  );
}
