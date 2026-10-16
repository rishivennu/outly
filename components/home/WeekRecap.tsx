"use client";
import { useState } from "react";
import Link from "next/link";
import * as Switch from "@radix-ui/react-switch";
import { ArrowRight, History, Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";
import { RECAP_COOKIE, compact } from "@/lib/reports/weekly-core";
import { PLATFORM_META, isPlatform } from "@/lib/domain";
import type { Recap } from "@/lib/reports/weekly";

/**
 * Monday and Tuesday on Home: how last week went, in a sentence, and the one thing to do about this one.
 * "Hide" lasts until next Monday (a cookie holding last week's key, so the server never renders it).
 */
export function WeekRecap({ r, canEmail }: { r: Recap; canEmail: boolean }) {
  const toast = useToast();
  const [hidden, setHidden] = useState(false);
  const [email, setEmail] = useState(r.emailOn);
  const [saving, setSaving] = useState(false);
  if (hidden) return null;

  const hide = () => {
    document.cookie = `${RECAP_COOKIE}=${r.key}; path=/; max-age=${8 * 86400}; samesite=lax`;
    setHidden(true);
    toast("Hidden until next Monday.", "info");
  };
  const flip = async (next: boolean) => {
    setEmail(next);
    setSaving(true);
    try {
      await api("/api/settings/profile", { method: "PATCH", json: { weeklyReport: next } });
      toast(next ? "You'll get this by email every Monday morning." : "Monday email turned off.", "ok");
    } catch (e) {
      setEmail(!next);
      toast(e instanceof ApiError ? e.message : "Something got in the way.", "error");
    } finally {
      setSaving(false);
    }
  };

  const max = Math.max(1, ...r.stats.byPlatform.map((b) => b.views));
  return (
    <section aria-labelledby="recap-h" className="glass relative min-w-0 rounded-[32px] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="recap-h" className="eyebrow flex items-center gap-2">
            <History className="h-3.5 w-3.5" aria-hidden="true" /> Last week, {r.label}
          </h2>
          <p className="display mt-2 text-2xl leading-tight sm:text-[28px]">{r.copy.headline}</p>
          {(r.copy.versus || r.copy.goal) && <p className="mt-1.5 text-sm text-muted-foreground">{[r.copy.versus, r.copy.goal].filter(Boolean).join(" ")}</p>}
        </div>
        <button type="button" onClick={hide} aria-label="Hide last week's recap until next Monday" className="-mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {(r.stats.top || r.stats.byPlatform.length > 0) && (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {r.stats.top && (
            <div className="rounded-2xl bg-secondary/60 p-4">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Trophy className="h-3.5 w-3.5" aria-hidden="true" /> Best of the week
              </p>
              <p className="mt-1.5 line-clamp-2 font-medium">{r.stats.top.title}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {compact(r.stats.top.views)} views on {isPlatform(r.stats.top.platform) ? PLATFORM_META[r.stats.top.platform].name : r.stats.top.platform}
              </p>
            </div>
          )}
          {r.stats.byPlatform.length > 0 && (
            <ul className="space-y-2 rounded-2xl bg-secondary/60 p-4" aria-label="By platform">
              {r.stats.byPlatform.map((b) => (
                <li key={b.platform} className="flex items-center gap-3 text-sm">
                  {isPlatform(b.platform) && <PlatformOrb platform={b.platform} size={24} />}
                  <span className="w-20 shrink-0 truncate font-medium">{isPlatform(b.platform) ? PLATFORM_META[b.platform].name : b.platform}</span>
                  <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
                    <span className="block h-full rounded-full bg-lime" style={{ width: `${Math.max(4, (b.views / max) * 100)}%` }} />
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {b.posts} post{b.posts === 1 ? "" : "s"}, {compact(b.views)} views
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {r.stats.upcoming ? `${r.stats.upcoming} lined up for this week.` : "Nothing lined up for this week yet."}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {canEmail && (
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm">
              <Switch.Root
                checked={email}
                onCheckedChange={flip}
                disabled={saving}
                aria-label="Email me this every Monday"
                className="relative h-7 w-12 shrink-0 rounded-full bg-secondary transition-colors hairline data-[state=checked]:bg-lime"
              >
                <Switch.Thumb className="block h-5 w-5 translate-x-1 rounded-full bg-muted-foreground shadow transition-transform data-[state=checked]:translate-x-6 data-[state=checked]:bg-[hsl(var(--lime-foreground))] motion-reduce:transition-none" />
              </Switch.Root>
              <span aria-hidden="true">Email me this every Monday</span>
            </label>
          )}
          <Button asChild variant="lime">
            <Link href={r.copy.cta.href}>
              {r.copy.cta.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Views are the latest numbers from each platform, and keep growing.</p>
    </section>
  );
}
