"use client";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Layers, Search } from "lucide-react";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { useToast } from "@/components/shared/Toast";
import { api } from "@/lib/client/api";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { matchProfile } from "@/lib/profiles-core";
import type { ProfileView } from "@/lib/profiles";

const tile =
  "relative flex min-h-[72px] w-full items-center gap-3 rounded-[20px] px-3.5 py-3 text-left hairline transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-wait";
const on = "bg-[hsl(var(--lime)/0.16)] ring-2 ring-[hsl(var(--lime))]";

/**
 * Every profile a manager runs, on Home (1037). Picking one scopes Home, Content, Calendar, Analytics and the
 * composer to that account; the pick is a cookie, so it holds across pages, reloads and tabs. Switching is a
 * server refresh in place: no full reload, no sign-out, and the scroll position stays.
 */
export function ProfileSwitcher({ profiles, activeId, children }: { profiles: ProfileView[]; activeId: string | null; children?: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<Platform | null>(null);
  const [picked, setPicked] = useState(activeId);
  const [pending, start] = useTransition();
  const platforms = useMemo(() => [...new Set(profiles.map((p) => p.platform))], [profiles]);
  const shown = profiles.filter((p) => (!only || p.platform === only) && matchProfile(p, q));
  const current = profiles.find((p) => p.id === picked) ?? null;

  const choose = async (id: string | null) => {
    if (id === picked) return;
    const before = picked;
    setPicked(id); // highlight at once; the numbers follow
    try {
      await api("/api/profiles/active", { method: "POST", json: { id } });
      start(() => router.refresh());
    } catch (e) {
      setPicked(before);
      toast(e instanceof Error ? e.message : "Couldn't switch profiles.", "error");
    }
  };

  return (
    <section aria-labelledby="profiles-h" className="mx-auto max-w-5xl px-5 pb-6 sm:px-10">
      <div className="glass rounded-[32px] p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 id="profiles-h" className="text-lg font-semibold">Your profiles</h2>
            <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
              {current ? <>Working on <span className="font-medium text-foreground">{current.username}</span>. Home, Content, Calendar and Analytics show only this account.</> : <>Showing all {profiles.length} accounts. Pick one to focus on it.</>}
            </p>
            {children}
          </div>
          {profiles.length > 4 && (
            <label className="relative block w-full sm:w-64">
              <span className="sr-only">Search profiles</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" className="h-11 w-full rounded-full bg-secondary/60 pl-10 pr-4 text-[15px] hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
            </label>
          )}
        </div>

        {platforms.length > 1 && (
          <div role="group" aria-label="Filter by platform" className="mt-4 flex flex-wrap gap-2">
            <button type="button" aria-pressed={only === null} onClick={() => setOnly(null)} className={cn("h-11 rounded-full px-4 text-sm font-medium hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", only === null ? "lime-bg text-[hsl(var(--lime-foreground))]" : "hover:bg-secondary/70")}>
              Every platform
            </button>
            {platforms.map((p) => (
              <button key={p} type="button" aria-pressed={only === p} onClick={() => setOnly(only === p ? null : p)} className={cn("flex h-11 items-center gap-2 rounded-full pl-2 pr-4 text-sm font-medium hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", only === p ? "lime-bg text-[hsl(var(--lime-foreground))]" : "hover:bg-secondary/70")}>
                <PlatformOrb platform={p} size={26} /> {PLATFORM_META[p].name}
              </button>
            ))}
          </div>
        )}

        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-busy={pending}>
          <li>
            <button type="button" aria-pressed={picked === null} disabled={pending} onClick={() => choose(null)} className={cn(tile, picked === null ? on : "hover:bg-secondary/70")}>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-secondary" aria-hidden="true"><Layers className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">All profiles</span>
                <span className="block text-sm text-muted-foreground">Everything combined</span>
              </span>
            </button>
          </li>
          {shown.map((p) => (
            <li key={p.id}>
              <button type="button" aria-pressed={picked === p.id} disabled={pending} onClick={() => choose(p.id)} className={cn(tile, picked === p.id ? on : "hover:bg-secondary/70")}>
                <span className="relative shrink-0">
                  {p.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.avatar} alt="" className="h-11 w-11 rounded-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="grid h-11 w-11 place-items-center rounded-full bg-secondary font-semibold" aria-hidden="true">{p.username.replace(/^@/, "").slice(0, 1).toUpperCase()}</span>
                  )}
                  <span className="absolute -bottom-1 -right-1"><PlatformOrb platform={p.platform} size={20} ring /></span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.username}</span>
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", p.online ? "bg-success" : "bg-muted-foreground/50")} aria-hidden="true" />
                    {p.online ? "Connected" : p.status === "expired" ? "Needs reconnecting" : "Offline"}
                    <span className="sr-only">, {PLATFORM_META[p.platform].name}{p.mock ? ", practice account" : ""}</span>
                    {p.scheduled > 0 && (
                      <span className="ml-auto flex items-center gap-1 tabular" title={`${p.scheduled} scheduled`}>
                        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> {p.scheduled}<span className="sr-only"> scheduled</span>
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="px-2 py-4 text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">No profile matches that.</li>}
        </ul>
      </div>
    </section>
  );
}
