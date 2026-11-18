"use client";
import { fmtHandle } from "@/lib/handle";
import { motion, useReducedMotion } from "framer-motion";
import { T } from "@/lib/motion/tokens";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { cn, compact } from "@/lib/utils";
import { freshness } from "@/lib/analytics/core";
import { bestBucket, type Bucket } from "@/lib/analytics/profile-core";
import type { PlatformDashboard } from "@/lib/live/types";

/** 1140: what /api/analytics/profile adds on top of the platform dashboard. */
export interface ProfileExtras extends PlatformDashboard {
  accountId: string | null;
  accounts: { accountId: string; username: string; displayName: string | null; avatar: string | null; status: string; practice?: boolean }[];
  formats: Bucket[];
  days: Bucket[];
  hoursPublished: (Bucket & { hour: number })[];
  timezone: string;
  lastSyncAt: string | null;
}

/**
 * The account switcher for a platform someone manages several accounts on. One account is one dashboard:
 * nothing is ever merged, because two profiles on the same platform are two different audiences.
 */
// 1172: lastSyncAt is optional; the dashboard header already says when Outlly last synced, so it leaves it out.
export function ProfileAccounts({ platform, accounts, active, onPick, busy, lastSyncAt }: { platform: Platform; accounts: ProfileExtras["accounts"]; active: string | null; onPick: (id: string) => void; busy: boolean; lastSyncAt?: string | null }) {
  if (accounts.length < 2) return null;
  const fresh = lastSyncAt === undefined ? null : freshness(lastSyncAt);
  return (
    <section aria-labelledby="accts" className="mt-6">
      <h2 id="accts" className="sr-only">
        Accounts on {PLATFORM_META[platform].name}
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label={`Which ${PLATFORM_META[platform].name} account`} className="flex flex-wrap gap-1 rounded-full bg-secondary/60 p-1 hairline">
          {accounts.map((a) => (
            <button
              key={a.accountId}
              type="button"
              role="radio"
              aria-checked={a.accountId === active}
              disabled={busy}
              onClick={() => onPick(a.accountId)}
              className={cn(
                "relative flex h-11 items-center gap-2 rounded-full px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                a.accountId === active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {a.accountId === active && <motion.span layoutId="acct-pick" className="absolute inset-0 rounded-full bg-background shadow-sm" transition={T.glide} />}
              <span className="relative flex items-center gap-2">
                {a.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.avatar} alt="" referrerPolicy="no-referrer" className="h-6 w-6 rounded-full object-cover" />
                ) : (
                  <PlatformOrb platform={platform} size={22} />
                )}
                {fmtHandle(a.username)}
                {a.status !== "connected" && <span className="text-xs font-semibold text-warning-ink">needs reconnect</span>}
                {a.practice && <span className="text-xs text-muted-foreground">practice</span>}
              </span>
            </button>
          ))}
        </div>
        {fresh && <p className="text-sm text-muted-foreground">{fresh.label}</p>}
      </div>
    </section>
  );
}

// 1172: format labels from the platform already read "Reels", "Carousels"; never add a second s.
const plural = (label: string) => (/s$/i.test(label) ? label : `${label}s`);

function Rows({ rows, unit }: { rows: Bucket[]; unit: string }) {
  const reduce = useReducedMotion();
  const max = Math.max(...rows.map((r) => r.views ?? 0), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li key={r.label}>
          <div className="mb-1.5 flex items-center gap-2.5 text-[15px]">
            <span className="font-medium">{r.label}</span>
            <span className="text-sm text-muted-foreground">
              {r.posts} {r.posts === 1 ? unit : `${unit}s`}
            </span>
            <span className="tabular ml-auto font-semibold">{r.views === null ? "No views reported" : compact(r.views)}</span>
            <span className="tabular w-20 text-right text-sm text-muted-foreground">{r.avgViews === null ? "" : `${compact(Math.round(r.avgViews))} avg`}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
            <motion.div className="h-full rounded-full bg-primary/70" initial={{ width: 0 }} animate={{ width: `${((r.views ?? 0) / max) * 100}%` }} transition={reduce ? { duration: 0 } : { delay: 0.15 + i * 0.05, duration: 0.6, ease: "easeInOut" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Formats, days and hours for one profile, worked out from the posts the platform already returned. A
 * format or day the platform gave no views for says so instead of showing a zero, and audience details
 * such as age or country are not shown at all: the permissions these platforms grant Outlly do not
 * include them, so there is nothing honest to put there.
 */
// 1172: rendered straight into the dashboard's 12-column grid (two tiles side by side, or one across).
export function ProfileBreakdowns({ x }: { x: ProfileExtras }) {
  const formats = x.formats.filter((f) => f.posts > 0);
  const days = x.days.filter((d) => d.posts > 0);
  const hours = x.hoursPublished;
  if (!formats.length && !days.length && !hours.length) return null;
  const bestFormat = bestBucket(formats);
  const bestDay = bestBucket(days);
  const both = formats.length > 0 && (days.length > 0 || hours.length > 0);
  const span = both ? "xl:col-span-6" : "md:col-span-2 xl:col-span-12";
  const card = "glass flex flex-col rounded-[24px] p-5 sm:p-6";
  const h2 = "text-base font-semibold sm:text-lg";
  return (
    <>
      {formats.length > 0 && (
        <section aria-labelledby="formats" className={cn(card, span)}>
          <h2 id="formats" className={h2}>What you post here</h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">
            {bestFormat ? `${plural(bestFormat.label)} average the most views of your formats.` : "From the posts this account returned."}
          </p>
          <Rows rows={formats} unit="post" />
          <p className="mt-auto pt-4 text-xs text-muted-foreground">
            {formats.reduce((a, f) => a + f.posts, 0)} posts returned by the platform, grouped by format. Views are the platform&apos;s own per-post counts.
          </p>
        </section>
      )}
      {(days.length > 0 || hours.length > 0) && (
        <section aria-labelledby="when" className={cn(card, span)}>
          <h2 id="when" className={h2}>When you post</h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">
            Your own times ({x.timezone}).{bestDay ? ` ${bestDay.label} posts average the most views.` : ""}
          </p>
          {days.length > 0 && <Rows rows={days} unit="post" />}
          {hours.length > 0 && (
            <div className="mt-5 border-t border-border/60 pt-4">
              <h3 className="mb-3 text-sm font-semibold">Hours you publish in</h3>
              <ul className="flex flex-wrap gap-2">
                {hours.map((h) => (
                  <li key={h.hour} className="rounded-full bg-secondary px-3 py-1.5 text-sm">
                    <span className="tabular font-medium">{h.label}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      {h.posts} {h.posts === 1 ? "post" : "posts"}
                      {h.avgViews === null ? "" : `, ${compact(Math.round(h.avgViews))} avg views`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </>
  );
}
