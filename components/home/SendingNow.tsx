"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { OutlyMark } from "@/components/brand/Logo";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { PLATFORM_META } from "@/lib/domain";
import type { SendingItem } from "@/lib/retention/pulse";
import { cn } from "@/lib/utils";

/** Same beats as the publishing screen; the post's fill is the average of its destinations. */
const AT: Record<string, number> = { pending: 6, queued: 14, uploading: 42, processing: 78, published: 100, failed: 100 };
const WORD: Record<string, string> = { pending: "waiting", queued: "queued", uploading: "sending", processing: "processing", published: "live", failed: "needs a hand" };

/** Home's Live Activity: posts still going out, so a creator who left the publish screen can see them land. */
export function SendingNow({ items }: { items: SendingItem[] }) {
  const router = useRouter();
  useEffect(() => {
    if (!items.length) return;
    const id = setInterval(() => !document.hidden && router.refresh(), 5000);
    return () => clearInterval(id);
  }, [items.length, router]);
  if (!items.length) return null;
  return (
    <section aria-label="Sending now" className="la-card relative overflow-hidden rounded-[2rem] p-5 text-white sm:p-6">
      <span className="la-grid" aria-hidden="true" />
      <p className="relative flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[hsl(var(--lime))]">
        <span className="pub-pulse" aria-hidden="true" /> Sending now
      </p>
      <ul className="relative mt-4 flex flex-col gap-4">
        {items.map((p) => {
          const pct = Math.round(p.targets.reduce((a, t) => a + (AT[t.status] ?? 6), 0) / Math.max(1, p.targets.length));
          const live = p.targets.filter((t) => t.status === "published").length;
          return (
            <li key={p.id}>
              <Link href={`/create?post=${p.id}`} className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--lime))]">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{p.title}</span>
                    <span className="block truncate text-sm text-white/60">
                      {live} of {p.targets.length} live · {p.targets.map((t) => `${PLATFORM_META[t.platform].name} ${WORD[t.status] ?? t.status}`).join(", ")}
                    </span>
                  </span>
                  <span className="flex -space-x-2" aria-hidden="true">
                    {p.targets.map((t, i) => <PlatformOrb key={i} platform={t.platform} size={28} ring />)}
                  </span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-white/60 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white" aria-hidden="true" />
                </div>
                <div className="la-track relative mt-3 h-10 rounded-full" role="progressbar" aria-label={`${p.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                  <div className={cn("la-fill la-fill-anim absolute inset-y-0 left-0 rounded-full")} style={{ width: `max(2.5rem, ${pct}%)` }}>
                    <span className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center">
                      <OutlyMark variant="ink" size={18} className="la-rocket la-rocket-anim" />
                    </span>
                  </div>
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs font-semibold tabular-nums text-white/60">{pct}%</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
