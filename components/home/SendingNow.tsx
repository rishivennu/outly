"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { PLATFORM_META, isPlatform, type Platform } from "@/lib/domain";
import type { SendingItem } from "@/lib/retention/pulse";
import { fetchSending, liveLabel, liveStep, onSendingWake, realPercent, stepText, updatedLabel, type LivePost } from "@/lib/client/sending";
import { cn } from "@/lib/utils";

/**
 * Home's Live Activity: posts still going out, so a creator who left the posting screen can see them land.
 * 1139: the real publishing state, not a guess. The server render shows what the page already knew; from then
 * on it reads /api/posts/sending, which also carries which account each destination goes to, the thumbnail and
 * when the platform last told us something. It wakes on a push arriving on this device (the service worker
 * messages every open page), when the tab comes back and on focus, so a post started on another device shows
 * up here without a reload. Progress is the step a destination is on; a percentage only ever appears if the
 * server really measured one.
 */
const IDLE_MS = 45_000;
const BUSY_MS = 6000;
const ACTIVE = ["pending", "queued", "uploading", "processing"];

export function SendingNow({ items }: { items: SendingItem[] }) {
  const [rows, setRows] = useState<LivePost[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (document.hidden) return;
    try {
      setRows(await fetchSending());
      setNow(Date.now());
    } catch {
      /* signed out or offline: the next wake tries again */
    }
  }, []);

  useEffect(() => {
    void load();
    return onSendingWake(() => void load());
  }, [load]);

  const busy = (rows ?? []).some((p) => p.targets.some((t) => ACTIVE.includes(t.status)));
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      void load();
    }, busy ? BUSY_MS : IDLE_MS);
    return () => clearInterval(id);
  }, [busy, load]);

  // Until the first answer arrives, show what the page was rendered with.
  const posts: LivePost[] =
    rows ??
    items.map((p) => ({
      id: p.id,
      title: p.title,
      caption: null,
      thumbnailUrl: null,
      format: "video",
      status: "publishing",
      updatedAt: null,
      targets: p.targets.map((t, i) => ({ id: `${p.id}-${i}`, platform: t.platform, status: t.status, errorCode: null, url: null, updatedAt: null, account: null, practice: false, caption: null })),
    }));
  if (!posts.length) return null;

  return (
    <section aria-label="Sending now" className="la-card relative overflow-hidden rounded-[2rem] p-5 text-white sm:p-6">
      <span className="la-grid" aria-hidden="true" />
      <p className="relative flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[hsl(var(--lime))]">
        <span className="pub-pulse" aria-hidden="true" /> Sending now
      </p>
      <ul className="relative mt-4 flex flex-col gap-5">
        {posts.map((p) => {
          const live = p.targets.filter((t) => t.status === "published").length;
          return (
            <li key={p.id}>
              <Link
                href={`/create?post=${p.id}`}
                className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--lime))]"
                aria-label={`${p.title}: ${live} of ${p.targets.length} live. Open the posting screen.`}
              >
                <div className="flex items-center gap-3">
                  {p.thumbnailUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={p.thumbnailUrl} alt="" className="la-thumb" draggable={false} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{p.title}</span>
                    <span className="block truncate text-sm text-white/60">
                      {live} of {p.targets.length} live
                      {p.caption ? ` · ${p.caption}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 -space-x-2" aria-hidden="true">
                    {p.targets.filter((t) => isPlatform(t.platform)).map((t) => <PlatformOrb key={t.id} platform={t.platform as Platform} size={28} ring />)}
                  </span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-white/60 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white" aria-hidden="true" />
                </div>
              </Link>
              <ul className="mt-3 flex flex-col gap-2.5">
                {p.targets.map((t) => {
                  const s = liveStep(t, p.status);
                  const pct = realPercent(t.progress);
                  const seen = updatedLabel(t.updatedAt, now);
                  return (
                    <li key={t.id} className="min-w-0">
                      <p className="flex flex-wrap items-baseline gap-x-2 text-[13px] leading-snug">
                        <span className="font-semibold">{isPlatform(t.platform) ? PLATFORM_META[t.platform].name : t.platform}</span>
                        <span className={cn(s.stalled ? "text-[#ff8a80]" : s.done ? "text-[hsl(var(--lime))]" : "text-white/70")}>{liveLabel(t, p.status)}</span>
                        {t.account && <span className="truncate text-white/50">{t.account.username ? `@${t.account.username}` : t.account.name}</span>}
                        {seen && <span className="text-white/40">{seen}</span>}
                      </p>
                      <span
                        className="la-steps mt-1.5"
                        role="progressbar"
                        aria-label={`${isPlatform(t.platform) ? PLATFORM_META[t.platform].name : t.platform} progress`}
                        aria-valuemin={0}
                        aria-valuemax={s.total}
                        aria-valuenow={s.index}
                        aria-valuetext={pct === null ? stepText(s) : `${pct}% uploaded, ${stepText(s)}`}
                      >
                        {Array.from({ length: s.total }, (_, i) => (
                          <span key={i} className={cn("la-step", s.stalled ? (i === 0 ? "la-step-bad" : "") : i < s.index ? "la-step-done" : i === s.index ? "la-step-now" : "")} />
                        ))}
                      </span>
                      <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/50">{pct === null ? stepText(s) : `${pct}% uploaded`}</p>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
