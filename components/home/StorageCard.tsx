import Link from "next/link";
import { ArrowUpRight, HardDrive } from "lucide-react";
import { StorageMeter, type StorageMeterData } from "@/components/billing/StorageMeter";

/** Home: how much of the plan's storage is used. Same server figures as Billing, so every device shows the same. */
export function StorageCard({ s, planName, canUpgrade }: { s: StorageMeterData; planName: string; canUpgrade: boolean }) {
  const tight = s.over || s.pct >= 80;
  return (
    <section aria-labelledby="home-storage" className="glass flex flex-col gap-4 rounded-[32px] p-5 sm:flex-row sm:items-center sm:p-6">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-secondary" aria-hidden="true">
        <HardDrive className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="home-storage" className="sr-only">Storage on {planName}</h2>
        <StorageMeter s={s} id="home-storage-l" />
        {!s.over && <p className="mt-1.5 text-xs text-muted-foreground">Total for every file you've uploaded on {planName}, on all your devices.</p>}
      </div>
      {canUpgrade && tight && (
        <Link href="/billing" className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-secondary px-4 text-sm font-medium transition hover:bg-secondary/70 focus-visible:outline-2">
          Get more room <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      )}
    </section>
  );
}
