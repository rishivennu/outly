"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Link2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";

type Loc = { approx: { label: string; at: string | null } | null };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

/**
 * Location (1053). Read from the network address only, never from the browser, so nothing ever asks for
 * permission. It's city level at best and shown here exactly as stored, labelled as an estimate.
 */
export function LocationCard() {
  const [loc, setLoc] = useState<Loc | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    setLoc(null);
    api<Loc>("/api/me/location").then(setLoc).catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  return (
    <section className="glass rounded-[32px] p-6 sm:p-8" aria-labelledby="loc-h" aria-busy={loc === null && !failed}>
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-secondary/70 hairline" aria-hidden="true"><MapPin className="h-5 w-5" /></span>
        <div className="min-w-0">
          <h2 id="loc-h" className="text-2xl font-semibold tracking-tight">Location</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">An estimate from your network address, used to spot unusual sign-ins and to help when you contact support. We never ask your device for its location. Never sold, never shown to other people.</p>
        </div>
      </div>
      <div className="mt-4 rounded-2xl bg-secondary/40 p-4" aria-live="polite">
        <p className="text-[13px] font-semibold">Approximate, from your network</p>
        {failed ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Couldn&apos;t load it.{" "}
            <button type="button" onClick={load} className="min-h-11 font-medium text-foreground underline underline-offset-2">Try again</button>
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            {loc === null ? "Loading…" : loc.approx ? <>Around {loc.approx.label}{loc.approx.at ? `, as of ${day(loc.approx.at)}` : ""}. A VPN or your mobile network can place you somewhere else.</> : "Not known yet. It fills in after your next visit."}
          </p>
        )}
      </div>
    </section>
  );
}

/** Connected accounts live on their own page; this is the door to it. */
export function ConnectedAccountsCard() {
  return (
    <section className="glass flex flex-wrap items-center justify-between gap-4 rounded-[32px] p-6 sm:p-8" aria-labelledby="ca-h">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-secondary/70 hairline" aria-hidden="true"><Link2 className="h-5 w-5" /></span>
        <div className="min-w-0">
          <h2 id="ca-h" className="text-2xl font-semibold tracking-tight">Connected accounts</h2>
          <p className="mt-1 text-sm text-muted-foreground">See what Outlly can post to, reconnect one, or remove its access.</p>
        </div>
      </div>
      <Button asChild variant="outline">
        <Link href="/accounts">
          Manage accounts <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </Button>
    </section>
  );
}
