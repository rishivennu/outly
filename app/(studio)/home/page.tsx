import Link from "next/link";
import { ArrowUpRight, CalendarClock, PenLine } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { postView } from "@/lib/services";
import { HomeHero } from "@/components/shared/HomeHero";
import { Thumb } from "@/components/shared/Thumb";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import type { Platform } from "@/lib/domain";
import { connectedPlatforms } from "@/lib/live/connected";
import { canConnectWithToken, hasCredentials, loadKeys } from "@/lib/social/registry";
import { SetupChecklist } from "@/components/onboarding/SetupChecklist";
import { WelcomeSubscribe, type WelcomeOffer } from "@/components/onboarding/WelcomeSubscribe";
import { entitlements, storageUsage } from "@/lib/billing/entitlements";
import { StorageCard } from "@/components/home/StorageCard";
import { listPlans } from "@/lib/billing/plans";
import { visitorCurrency } from "@/lib/billing/visitor";
import { localPrice } from "@/lib/billing/currency";
import { formatMoney } from "@/lib/billing/money";
import { homeRetention } from "@/lib/retention/home";
import { NextSteps } from "@/components/home/NextSteps";
import { GoalRing } from "@/components/home/GoalRing";
import { IdeaBank } from "@/components/home/IdeaBank";
import { RecycleCard } from "@/components/home/RecycleCard";
import { SendingNow } from "@/components/home/SendingNow";
import { WeekPulse } from "@/components/home/WeekPulse";
import { WeekRecap } from "@/components/home/WeekRecap";
import { RECAP_COOKIE } from "@/lib/reports/weekly-core";
import { lastWeekRecap } from "@/lib/reports/weekly";
import { cookies } from "next/headers";
import { homePulse } from "@/lib/retention/pulse";
import { isPlatform } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { myFounding } from "@/lib/founding";
import { FoundingWelcome, type FoundingPromo } from "@/components/founding/FoundingWelcome";
import { listProfiles, postFilter } from "@/lib/profiles";
import { trustBadges } from "@/lib/badges";
import { ProfileSwitcher } from "@/components/home/ProfileSwitcher";
import { TrustBadges } from "@/components/shared/TrustBadges";
import { savedTime } from "@/lib/retention/time-saved";
import { TimeSavedCard } from "@/components/home/TimeSavedCard";
import { soft } from "@/lib/budget";
import { dashboardFor } from "@/lib/dashboard-style";
import { getPulse } from "@/lib/dashboard/pulse";
import { analyticsScope } from "@/lib/profiles";
import { PulseHome } from "@/components/dashboard/PulseHome";
import { DashboardSwitch } from "@/components/home/DashboardSwitch";

const NEW_FOR_DAYS = 14;
/** 1079: the longest Home waits for any one optional card. Past it the card sits out this visit and the page renders. */
const CARD_MS = 5000;

/** Free, owner-level accounts that are new or haven't published yet get the subscribe greeting once. */
async function welcomeOffer(user: { id: string; createdAt: Date; actor: unknown }) {
  if (user.actor) return null; // billing belongs to the workspace owner
  const [ent, published, plans] = await Promise.all([
    entitlements(user.id),
    db.post.count({ where: { userId: user.id, status: { in: ["published", "partial"] } } }),
    listPlans(),
  ]);
  const isNew = Date.now() - user.createdAt.getTime() < NEW_FOR_DAYS * 86_400_000;
  if (ent.planSlug !== "free" || (!isNew && published > 0)) return null;
  const paid = plans.filter((p) => p.priceMinor > 0 && p.state === "available");
  const pick = paid.find((p) => p.highlight) ?? paid[0];
  if (!pick) return { freeLimit: ent.postLimit, freePeriod: ent.postPeriod, offer: null };
  const visitor = visitorCurrency((pick.currency as never) ?? "INR");
  const lp = localPrice(pick, visitor.currency);
  const offer: WelcomeOffer = { slug: pick.slug, name: pick.name, price: formatMoney(lp.priceMinor, lp.currency), interval: pick.interval === "year" ? "year" : "month", features: pick.features.slice(0, 3), postLimit: pick.postLimit, aiCaptions: pick.aiCaptions, postPeriod: pick.postPeriod };
  return { freeLimit: ent.postLimit, freePeriod: ent.postPeriod, offer };
}

type HomeUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/**
 * 1080: the analytics Home ("pulse"). Keeps the first-run pieces (checklist, founding / subscribe greeting) above
 * the dashboard and drops the classic cards. Null when the numbers can't be read in time, so Home falls back to classic.
 */
async function pulseView(user: HomeUser, canSwitch: boolean) {
  const [scope, accountIds] = await Promise.all([postFilter(user), analyticsScope(user)]);
  const [, data, next, live, published, welcome, founding, firstWin] = await Promise.all([
    loadKeys(),
    soft(getPulse(user.id, 7, accountIds), CARD_MS, null, "home analytics"),
    db.post.findFirst({ where: { userId: user.id, status: "scheduled", scheduledAt: { gte: new Date() }, ...scope.where }, select: { title: true, scheduledAt: true }, orderBy: { scheduledAt: "asc" } }),
    connectedPlatforms(user.id),
    db.post.count({ where: { userId: user.id, status: { in: ["published", "partial"] } } }),
    soft(welcomeOffer(user), CARD_MS, null, "home welcome"),
    user.actor ? null : soft(myFounding(user.id), CARD_MS, null, "home founding"),
    soft(
      Promise.all([
        db.media.findFirst({ where: { userId: user.id }, select: { id: true } }),
        db.post.findFirst({ where: { userId: user.id, launchedAt: { not: null } }, select: { id: true } }),
      ]),
      CARD_MS,
      [null, null] as const,
      "home first win",
    ),
  ]);
  if (!data) return null;
  const setup = {
    connected: { instagram: !!live.instagram, youtube: !!live.youtube },
    instagram: { oauth: hasCredentials("instagram"), token: canConnectWithToken("instagram") },
    youtube: { oauth: hasCredentials("youtube") },
    uploaded: !!firstWin[0],
    scheduled: !!firstWin[1] || published > 0,
  };
  const promo: FoundingPromo | null =
    founding?.kind === "offer" && !founding.seen ? { kind: "offer", left: founding.left, limit: founding.limit, pct: founding.pct, proven: founding.proven }
    : founding?.kind === "reserved" && !founding.seen ? { kind: "reserved", no: founding.no, pct: founding.pct }
    : null;
  const nextPost = next?.scheduledAt
    ? { title: next.title ?? "Untitled post", when: new Intl.DateTimeFormat("en-US", { timeZone: user.timezone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(next.scheduledAt) }
    : null;
  const firstName = user.name.split(" ")[0];
  return (
    <div className="relative">
      <div className="pt-4">
        <SetupChecklist state={setup} />
        {promo ? (
          <FoundingWelcome promo={promo} />
        ) : (
          welcome && <WelcomeSubscribe firstName={firstName} offer={welcome.offer} freeLimit={welcome.freeLimit} freePeriod={welcome.freePeriod} foundingFull={founding?.kind === "full" ? founding.limit : null} />
        )}
      </div>
      <PulseHome initial={data} firstName={firstName} canSwitch={canSwitch} nextPost={nextPost} />
    </div>
  );
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

export default async function HomePage({ searchParams }: { searchParams?: { recapAt?: string } }) {
  const user = (await getCurrentUser())!;
  const dash = await dashboardFor();
  if (dash.style === "pulse") {
    const view = await pulseView(user, dash.canSwitch).catch(() => null);
    if (view) return view;
  }
  // One parallel wave: every query below is independent, so the page pays one database round trip, not four.
  // Pulse only needs the connections and the published count, so it chains on those two instead of waiting for all.
  const liveP = connectedPlatforms(user.id);
  const publishedP = db.post.count({ where: { userId: user.id, status: { in: ["published", "partial"] } } });
  const meP = db.user.findUnique({ where: { id: user.id }, select: { postingGoal: true, weeklyReport: true } });
  const recapHidden = cookies().get(RECAP_COOKIE)?.value;
  // Dev only: preview the Monday card on any day (?recapAt=2026-10-19T05:00:00Z).
  const recapAt = process.env.NODE_ENV !== "production" && searchParams?.recapAt ? new Date(searchParams.recapAt) : new Date();
  // 1037: the picked profile (or a member's accounts) narrows the drafts and the next post too.
  const [profiles, scope, badges] = await Promise.all([listProfiles(user.id, user.scope), postFilter(user), trustBadges(user.id)]);
  const [, drafts, next, live, welcome, published, ret, pulse, recap, founding, saved, storage, firstWin] = await Promise.all([
    loadKeys(),
    db.post.findMany({ where: { userId: user.id, status: "draft", ...scope.where }, include: { targets: true, media: true }, orderBy: { updatedAt: "desc" }, take: 3 }),
    db.post.findFirst({ where: { userId: user.id, status: "scheduled", scheduledAt: { gte: new Date() }, ...scope.where }, include: { targets: true, media: true }, orderBy: { scheduledAt: "asc" } }),
    liveP,
    soft(welcomeOffer(user), CARD_MS, null, "home welcome"),
    publishedP,
    soft(meP.then((me) => homeRetention({ id: user.id, postingGoal: me?.postingGoal ?? 3, timezone: user.timezone })), CARD_MS, null, "home retention"),
    soft(
      Promise.all([liveP, publishedP]).then(([lv, pub]) =>
        Object.values(lv).some(Boolean) || pub > 0 ? homePulse({ id: user.id, timezone: user.timezone }, Object.keys(lv).filter((k) => lv[k as Platform] && isPlatform(k)) as Platform[]) : null,
      ),
      CARD_MS,
      null,
      "home pulse",
    ),
    soft(
      meP
        .then((me) => lastWeekRecap({ id: user.id, timezone: user.timezone, postingGoal: me?.postingGoal ?? 3, weeklyReport: me?.weeklyReport ?? true }, Number.isNaN(+recapAt) ? new Date() : recapAt))
        .then((r) => (r && r.key === recapHidden ? null : r)),
      CARD_MS,
      null,
      "home recap",
    ),
    user.actor ? null : soft(myFounding(user.id), CARD_MS, null, "home founding"),
    soft(savedTime(user.id, Date.now(), scope.where), CARD_MS, null, "home saved"),
    soft(storageUsage(user.id), CARD_MS, null, "home storage"),
    // 1076: the checklist runs to a first win, so it needs to know about the first upload and the first post sent or booked
    soft(
      Promise.all([
        db.media.findFirst({ where: { userId: user.id }, select: { id: true } }),
        db.post.findFirst({ where: { userId: user.id, launchedAt: { not: null } }, select: { id: true } }),
      ]),
      CARD_MS,
      [null, null] as const,
      "home first win",
    ),
  ]);
  const started = Object.values(live).some(Boolean) || published > 0;
  const steps = ret?.steps ?? [];
  const recycle = ret?.recycle ?? [];
  // Ideas fill a whole row when nothing sits beside them; with no steps they pair with the streak card.
  const ideasWide = ret ? steps.length > 0 && recycle.length === 0 : true;
  const setup = {
    connected: { instagram: !!live.instagram, youtube: !!live.youtube },
    instagram: { oauth: hasCredentials("instagram"), token: canConnectWithToken("instagram") },
    youtube: { oauth: hasCredentials("youtube") },
    uploaded: !!firstWin[0],
    scheduled: !!firstWin[1] || published > 0,
  };
  // one tick, so every signed URL on the page goes out as a single batch
  const [dv, nv] = await Promise.all([Promise.all(drafts.map(postView)), next ? postView(next) : null]);
  // 1067: the founding invitation is a one-time popup, only for accounts the server says can still earn a seat
  // and that haven't closed it on any device. Members get their badge below; nothing else founding sits on Home.
  const promo: FoundingPromo | null =
    founding?.kind === "offer" && !founding.seen ? { kind: "offer", left: founding.left, limit: founding.limit, pct: founding.pct, proven: founding.proven }
    : founding?.kind === "reserved" && !founding.seen ? { kind: "reserved", no: founding.no, pct: founding.pct }
    : null;
  const when = nv?.scheduledAt
    ? new Intl.DateTimeFormat("en-US", { timeZone: user.timezone, weekday: "long", hour: "numeric", minute: "2-digit" }).format(new Date(nv.scheduledAt))
    : null;

  return (
    <div className="relative overflow-hidden">
      {dash.canSwitch && <div className="mx-auto flex max-w-5xl justify-end px-5 pt-4 sm:px-10"><DashboardSwitch current="classic" /></div>}
      <HomeHero firstName={user.name.split(" ")[0]} />
      {profiles.length >= 2 ? (
        <ProfileSwitcher profiles={profiles} activeId={scope.active?.id ?? null}>
          <TrustBadges b={badges} className="mt-3" />
        </ProfileSwitcher>
      ) : (
        (badges.verifiedManager || badges.foundingNo) && <div className="mx-auto max-w-5xl px-5 pb-4 sm:px-10"><TrustBadges b={badges} /></div>
      )}
      <SetupChecklist state={setup} />
      {promo ? (
        <FoundingWelcome promo={promo} />
      ) : (
        welcome && <WelcomeSubscribe firstName={user.name.split(" ")[0]} offer={welcome.offer} freeLimit={welcome.freeLimit} freePeriod={welcome.freePeriod} foundingFull={founding?.kind === "full" ? founding.limit : null} />
      )}
      {(pulse || recap || (saved && saved.posts > 0)) && (
        <div className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-4 px-5 pb-4 sm:px-10">
          {recap && <WeekRecap r={recap} canEmail={!user.actor} />}
          {pulse && <SendingNow items={pulse.sending} />}
          {pulse && <WeekPulse p={pulse} />}
          {saved && <TimeSavedCard t={saved} />}
        </div>
      )}
      {started && (
        // One 12-column bento: next steps beside the streak, ideas beside recycling. Spans adapt to what's there.
        <div className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-4 px-5 pb-10 sm:px-10 md:grid-cols-12">
          {steps.length > 0 && <div className="grid min-w-0 md:col-span-7"><NextSteps steps={steps} /></div>}
          {ret && <div className="grid min-w-0 md:col-span-5"><GoalRing goal={ret.goal} scheduled={ret.scheduledThisWeek} canEdit={!user.actor} /></div>}
          <div className={cn("grid min-w-0", ideasWide ? "md:col-span-12" : "md:col-span-7")}><IdeaBank wide={ideasWide} /></div>
          {recycle.length > 0 && <div className={cn("grid min-w-0", ret && steps.length === 0 ? "md:col-span-12" : "md:col-span-5")}><RecycleCard posts={recycle} /></div>}
        </div>
      )}
      {storage && (
        <div className="mx-auto max-w-5xl px-5 pb-4 sm:px-10">
          <StorageCard s={storage} planName={storage.planName} canUpgrade={!user.actor && storage.planSlug !== "pro-manager"} />
        </div>
      )}
      {(dv.length > 0 || nv) && (
        <section aria-label="Pick up where you left off" className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-4 px-5 pb-20 sm:px-10 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          {dv.length > 0 && (
            <div className="glass min-w-0 rounded-[32px] p-5">
              <p className="eyebrow mb-4 flex items-center gap-2"><PenLine className="h-3.5 w-3.5" aria-hidden="true" /> Pick up where you left off</p>
              <ul className="flex flex-col gap-2">
                {dv.map((p) => (
                  <li key={p.id}>
                    <Link href={`/create?post=${p.id}`} className="group flex items-center gap-4 rounded-2xl p-2 transition hover:bg-secondary">
                      <Thumb src={p.media.thumbnailUrl} alt="" className="h-16 w-12 shrink-0 rounded-xl" playOnHover={false} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.title ?? "Untitled idea"}</span>
                        <span className="block truncate text-sm text-muted-foreground">{p.story ?? "No story yet"}</span>
                      </span>
                      <ArrowUpRight className="h-4 w-4 text-muted-foreground transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {nv && (
            <Link href="/calendar" className="group relative flex min-h-[180px] flex-col justify-end overflow-hidden rounded-[32px] p-6 hairline">
              <Thumb src={nv.media.thumbnailUrl} alt="" className="absolute inset-0 opacity-45 transition duration-500 group-hover:scale-105 dark:opacity-60" playOnHover={false} />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
              <div className="relative">
                <p className="eyebrow mb-2 flex items-center gap-2"><CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> Coming up</p>
                <p className="line-clamp-2 text-xl font-semibold tracking-tight">{nv.title}</p>
                <div className="mt-3 flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="flex -space-x-2">{nv.targets.map((t) => <PlatformOrb key={t.id} platform={t.platform as Platform} size={26} ring />)}</span>
                  goes live {when}
                </div>
              </div>
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
