"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Handshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedNumber } from "@/components/shared/AnimatedNumber";
import { useToast } from "@/components/shared/Toast";
import { cn } from "@/lib/utils";
import type { MineApplication, MineSummary } from "@/lib/partners/mine-types";
import { APPLY_HREF, countLabel, dayLabel, detailPath, handleLabel, nextActionHref, nextActionLabel, platformLabel } from "./model";
import { StatusPill } from "./StatusPill";

const CARDS: { key: keyof MineSummary; label: string }[] = [
  { key: "submitted", label: "Applications Submitted" },
  { key: "underReview", label: "Under Review" },
  { key: "offers", label: "Offers Received" },
  { key: "active", label: "Active Partnerships" },
];

export function SummaryCards({ summary }: { summary: MineSummary }) {
  return (
    <ul aria-label="Your partnership numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {CARDS.map((c) => (
        <li key={c.key} className="min-w-0 rounded-[24px] border border-foreground/[0.08] bg-card p-4 sm:p-5">
          <p className="text-[13px] font-medium leading-snug text-muted-foreground">{c.label}</p>
          <p className="mt-2 text-[28px] font-semibold leading-none tabular-nums sm:text-[32px]">
            <AnimatedNumber value={summary[c.key] ?? 0} format="int" id={`partnerships:${c.key}`} />
          </p>
        </li>
      ))}
    </ul>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted-foreground">{term}</dt>
      <dd className="truncate text-[14px] font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function AppCard({ app, fresh }: { app: MineApplication; fresh: boolean }) {
  const href = nextActionHref(app);
  const primary = app.nextAction.kind !== "none" && app.nextAction.kind !== "withdraw";
  return (
    <li
      id={`app-${app.ref}`}
      data-ref={app.ref}
      data-fresh={fresh ? "" : undefined}
      className={cn("min-w-0 rounded-[24px] border bg-card p-5 sm:p-6", fresh ? "border-lime-ink/60 ring-2 ring-lime/40" : "border-foreground/[0.08]")}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] text-muted-foreground">Application ID</p>
          <h2 className="font-mono text-[17px] font-semibold tracking-normal">
            <Link href={detailPath(app.ref)} className="rounded-md outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{app.ref}</Link>
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {fresh && <span className="inline-flex min-h-7 items-center rounded-full bg-lime px-2.5 text-xs font-semibold text-lime-foreground">Just submitted</span>}
          <StatusPill status={app.status} />
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        <Fact term="Submitted" value={dayLabel(app.createdAt)} />
        <Fact term="Platform" value={platformLabel(app.primaryPlatform) || "Not provided"} />
        <Fact term="Username" value={handleLabel(app.primaryHandle) || "Not provided"} />
        <Fact term="Followers" value={countLabel(app.followers)} />
        <Fact term="Status" value={app.statusLabel} />
        <Fact term="Last update" value={dayLabel(app.lastStatusAt || app.updatedAt)} />
      </dl>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button asChild variant={primary ? "lime" : "subtle"} size="md" className="w-full sm:w-auto">
          <Link href={href}>
            {nextActionLabel(app)} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
        {primary && (
          <Button asChild variant="ghost" size="md" className="w-full sm:w-auto">
            <Link href={detailPath(app.ref)}>View details</Link>
          </Button>
        )}
      </div>
    </li>
  );
}

/** `fresh` = the ref from ?new= right after the application form: its card is marked and one toast says so. */
export function PartnershipsList({ apps, fresh }: { apps: MineApplication[]; fresh: string | null }) {
  const toast = useToast();
  const told = useRef(false);
  const match = fresh ? apps.find((a) => a.ref.toUpperCase() === fresh.toUpperCase()) ?? null : null;
  // Kept in state: the mark stays after ?new= leaves the address bar.
  const [mark] = useState(() => match?.ref ?? null);

  useEffect(() => {
    if (!match || told.current) return;
    told.current = true;
    toast(`Just submitted: ${match.ref}. We'll let you know when there's an update.`, "ok");
    document.getElementById(`app-${match.ref}`)?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    // Drop ?new= so a refresh or a shared link does not announce it again (no server round trip).
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [match, toast]);

  if (!apps.length)
    return (
      <section aria-labelledby="pp-empty" className="flex flex-col items-center rounded-[24px] border border-foreground/[0.08] bg-card px-6 py-12 text-center">
        <span aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-full bg-lime/15 text-lime-ink">
          <Handshake className="h-6 w-6" />
        </span>
        <h2 id="pp-empty" className="mt-4 text-[19px] font-semibold">No applications yet</h2>
        <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-muted-foreground">Apply to the Creator Partnership Program and track every step here.</p>
        <Button asChild variant="lime" size="md" className="mt-6">
          <Link href={APPLY_HREF}>Partner with us</Link>
        </Button>
      </section>
    );

  return (
    <ul aria-label="Your applications" className="grid gap-4">
      {apps.map((a) => (
        <AppCard key={a.id} app={a} fresh={mark === a.ref} />
      ))}
    </ul>
  );
}
