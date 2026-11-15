"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { ConnectOption } from "@/lib/onboarding-core";

/** Where a connect sends the person back to: this page, with the flow open on this step again. */
const back = () => `${location.pathname}?setup=connect`;

function Action({ o }: { o: ConnectOption }) {
  if (o.status === "needs_reconnect")
    return (
      <Button asChild size="sm" variant="outline" className="min-h-11">
        <Link href="/accounts">Reconnect</Link>
      </Button>
    );
  if (o.status) return null;
  if (o.how === "oauth" || o.how === "practice")
    return (
      <Button asChild size="sm" variant="primary" className="min-h-11">
        <a href={`/api/accounts/${o.platform}/connect`} onClick={(e) => (e.currentTarget.href = `/api/accounts/${o.platform}/connect?returnTo=${encodeURIComponent(back())}`)} aria-label={`Connect ${o.name}`}>
          Connect <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </a>
      </Button>
    );
  return (
    <Button asChild size="sm" variant="outline" className="min-h-11">
      <Link href="/accounts" aria-label={`Connect ${o.name} with an access token`}>Use a token</Link>
    </Button>
  );
}

/** Every platform this server can really connect, with its live status; the rest are listed as coming later. */
export function ConnectStep({ options }: { options: ConnectOption[] }) {
  const ready = options.filter((o) => o.status || o.how !== "later");
  const later = options.filter((o) => !o.status && o.how === "later");
  return (
    <div>
      <p className="text-[15px] leading-relaxed text-muted-foreground">You sign in on each platform&apos;s own page, so Outlly never sees your password. Connect one now or skip and do it later from Connected accounts.</p>
      {ready.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2" aria-label="Platforms you can connect">
          {ready.map((o) => (
            <li key={o.platform} className="flex min-h-14 items-center gap-3 rounded-2xl bg-secondary/40 p-2.5 pl-3">
              <PlatformOrb platform={o.platform} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{o.name}</p>
                {o.status ? (
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <StatusBadge status={o.status} />
                    {o.username && <span className="truncate">@{o.username.replace(/^@/, "")}</span>}
                    {o.practice && <span>Practice account, nothing is posted</span>}
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-muted-foreground">{o.how === "practice" ? "Practice mode: a stand-in account, nothing is posted" : o.how === "token" ? "Connect with an access token on Connected accounts" : "Not connected"}</p>
                )}
              </div>
              <Action o={o} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-2xl bg-secondary/40 p-3 text-sm text-muted-foreground">No platform can be connected on this server yet. The owner needs to add the platform app keys first.</p>
      )}
      {later.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-muted-foreground">Coming later</p>
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="Coming later">
            {later.map((o) => (
              <li key={o.platform} className="inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-xs text-muted-foreground hairline">
                <PlatformOrb platform={o.platform} size={18} />
                {o.name}
                <span className="sr-only">, coming later</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
