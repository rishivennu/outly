import Link from "next/link";
import { Suspense } from "react";
import { ArrowUpRight, CalendarClock, PenLine } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { postView } from "@/lib/services";
import { HomeHero } from "@/components/shared/HomeHero";
import { Thumb } from "@/components/shared/Thumb";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import type { Platform } from "@/lib/domain";
import { connectedPlatforms } from "@/lib/live/connected";
import { loadKeys } from "@/lib/social/registry";
import { SetupChecklist } from "@/components/onboarding/SetupChecklist";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { onboardingFor } from "@/lib/onboarding";
import { SETUP_DEVICE_COOKIE, SETUP_HIDDEN_COOKIE, deviceHint, setupHiddenFor } from "@/lib/onboarding-core";
import { WelcomeSubscribe, type WelcomeOffer } from "@/components/onboarding/WelcomeSubscribe";
import { entitlements, storageUsage } from "@/lib/billing/entitlements";
import { hasPerk } from "@/lib/billing/plan-rules";
import { StorageCard } from "@/components/home/StorageCard";
import { listPlans } from "@/lib/billing/plans";
import { visitorCurrency } from "@/lib/billing/visitor";
import { localPrice } from "@/lib/billing/currency";
import { formatMoney } from "@/lib/billing/money";
import { getPolicy, quote, trialState } from "@/lib/subscriptions";
import type { TrialView } from "@/components/billing/offer-core";
import { homeRetention } from "@/lib/retention/home";
import { NextSteps } from "@/components/home/NextSteps";
import { GoalRing } from "@/components/home/GoalRing";
import { IdeaBank } from "@/components/home/IdeaBank";
import { RecycleCard } from "@/components/home/RecycleCard";
import { SendingNow } from "@/components/home/SendingNow";
import { WeekPulse } from "@/components/home/WeekPulse";
import { PageFresh } from "@/components/shell/PageFresh";
import { WeekRecap } from "@/components/home/WeekRecap";
import { RECAP_COOKIE } from "@/lib/reports/weekly-core";
import { lastWeekRecap } from "@/lib/reports/weekly";
import { cookies, headers } from "next/headers";
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
import { IntelligencePulseCard } from "@/components/home/IntelligencePulse";
import { intelligencePulse } from "@/lib/intelligence/pulse";
import { soft } from "@/lib/budget";
import { dashboardFor } from "@/lib/dashboard-style";
import { getPulse } from "@/lib/dashboard/pulse";
import { analyticsScope } from "@/lib/profiles";
import { PulseHome } from "@/components/dashboard/PulseHome";
import { PeepSpot } from "@/components/ui/art/peeps/Peep";
import { PulseSkeleton } from "@/components/dashboard/PulseSkeleton";
import { DashboardSwitch } from "@/components/home/DashboardSwitch";
import { HomeContentMark } from "@/components/home/HomeContentMark";
import { HomeRefresh } from "@/components/home/HomeRefresh";
import { timingContent } from "@/lib/server-timing";
import type { Pulse } from "@/lib/dashboard/pulse-core";

const NEW_FOR_DAYS = 14;
/**
 * 1079: the longest Home waits for any one optional card. Past it the card sits out this visit and the page renders.
 * 1142: 1.5 s (was 5 s): one slow greeting card held the whole Home for up to five seconds.
 */
const CARD_MS = 1500;
/**
 * The dashboard numbers are the page itself (without them Home falls back to the classic cards), so they get longer.
 * Perf: they stream in their own Suspense boundary behind PulseSkeleton, so this no longer holds the page's HTML.
 */
const PULSE_MS = 5000;

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
  if (!pick) return { freeLimit: ent.postLimit, freePeriod: ent.postPeriod, offer: null, trial: null as TrialView | null };
  const visitor = await visitorCurrency((pick.currency as never) ?? "INR");
  const lp = localPrice(pick, visitor.currency);
  const offer: WelcomeOffer = { slug: pick.slug, name: pick.name, price: formatMoney(lp.priceMinor, lp.currency), interval: pick.interval === "year" ? "year" : "month", features: pick.features.slice(0, 3), postLimit: pick.postLimit, aiCaptions: pick.aiCaptions, postPeriod: pick.postPeriod };
  // 1147: with the first-time pricing policy on, greet with the price this person would actually pay, and the trial.
  let trial: TrialView | null = null;
  const policy = await getPolicy().catch(() => null);
  if (policy?.enabled) {
    const [q, t] = await Promise.all([
      quote({ userId: user.id, planSlug: pick.slug, currency: lp.currency as never, interval: offer.interval === "year" ? "year" : "month" }).catch(() => null),
      trialState(user.id).catch(() => null),
    ]);
    if (q && q.tier === "intro") {
      offer.price = formatMoney(q.priceMinor, q.currency);
      offer.note = `First-time subscriber offer. Renews at this price while you stay subscribed.`;
    }
    if (t && !t.trial && !t.reason) trial = { status: "none", planName: plans.find((p) => p.slug === t.planSlug)?.name ?? "Creator", days: t.trialDays, endsAt: null, block: null };
  }
  return { freeLimit: ent.postLimit, freePeriod: ent.postPeriod, offer, trial };
}

type HomeUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
/** Perf (CLS): what the setup checklist cookies say, so it renders in the first HTML (lib/onboarding-core.ts). */
type Setup = { hidden: boolean; deviceOpen: boolean | null };

/** Perf: the dashboard numbers, streamed after the first cards. Out of time or failed: the classic cards, as before. */
async function PulseBlock(p: { data: Promise<{ d: Pulse | null; ms: number }>; firstName: string; canSwitch: boolean; nextPost: { when: string; title: string } | null; nonce?: string; fallback: () => Promise<React.ReactNode> }) {
  const { d, ms } = await p.data;
  if (!d) {
    try {
      return await p.fallback();
    } catch {
      return null;
    }
  }
  return (
    <>
      <meta name="x-timing" content={timingContent({ pulse: ms })} />
      <PulseHome initial={d} firstName={p.firstName} canSwitch={p.canSwitch} nextPost={p.nextPost} emptyArt={<PeepSpot name="numbers" height={88} />} />
      <HomeContentMark nonce={p.nonce} />
    </>
  );
}

/**
 * 1080: the analytics Home ("pulse"). Keeps the first-run pieces (checklist, founding / subscribe greeting) above
 * the dashboard and drops the classic cards. When the numbers can't be read in time, Home falls back to classic.
 * Perf: the first-run pieces render first (CARD_MS each); the numbers stream into the same place behind a
 * skeleton of the same shape, so the first byte no longer waits up to PULSE_MS on them.
 */
async function pulseView(user: HomeUser, canSwitch: boolean, setup: Setup, nonce: string | undefined, classic: () => Promise<React.ReactNode>) {
  const t0 = performance.now();
  const [scope, accountIds] = await Promise.all([postFilter(user), analyticsScope(user)]);
  const data = soft(getPulse(user.id, 7, accountIds), PULSE_MS, null, "home analytics").then((d) => ({ d, ms: performance.now() - t0 }));
  const [, next, welcome, founding, onboarding, intel] = await Promise.all([
    loadKeys(),
    db.post.findFirst({ where: { userId: user.id, status: "scheduled", scheduledAt: { gte: new Date() }, ...scope.where }, select: { title: true, scheduledAt: true }, orderBy: { scheduledAt: "asc" } }),
    soft(welcomeOffer(user), CARD_MS, null, "home welcome"),
    user.actor ? null : soft(myFounding(user.id), CARD_MS, null, "home founding"),
    soft(onboardingFor(user), CARD_MS, null, "home onboarding"),
    // R1326 review: the Intelligence pulse on the pulse-style Home as well (owners only, never fatal).
    user.actor ? null : soft(intelligencePulse(user.id), CARD_MS, null, "home intelligence"),
  ]);
  const tCards = performance.now();
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
      <meta name="x-timing" content={timingContent({ home: tCards - t0 })} />
      <div className="pt-4">
        {onboarding && <OnboardingFlow initial={onboarding} auto />}
        {onboarding && <SetupChecklist onboarding={onboarding} hidden={setup.hidden} deviceOpen={setup.deviceOpen} />}
        {promo ? (
          <FoundingWelcome promo={promo} />
        ) : (
          welcome && <WelcomeSubscribe firstName={firstName} offer={welcome.offer} freeLimit={welcome.freeLimit} freePeriod={welcome.freePeriod} foundingFull={founding?.kind === "full" ? founding.limit : null} trial={welcome.trial} />
        )}
      </div>
      <Suspense fallback={<PulseSkeleton firstName={firstName} nextPost={nextPost} />}>
        <PulseBlock data={data} firstName={firstName} canSwitch={canSwitch} nextPost={nextPost} nonce={nonce} fallback={classic} />
      </Suspense>
      {intel && <div className="mt-4"><IntelligencePulseCard p={intel} /></div>}
      {/* 1114: may open from the background preload; brings itself up to date when that copy is 90 s old. */}
      <PageFresh renderedAt={Date.now()} maxAge={90_000} />
    </div>
  );
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

export default async function HomePage(props: { searchParams?: Promise<{ recapAt?: string }> }) {
  const searchParams = await props.searchParams;
  const user = (await getCurrentUser())!;
  const [dash, jar, h] = await Promise.all([dashboardFor(), cookies(), headers()]);
  const setup: Setup = { hidden: setupHiddenFor(jar.get(SETUP_HIDDEN_COOKIE)?.value, user.id), deviceOpen: deviceHint(jar.get(SETUP_DEVICE_COOKIE)?.value) };
  const nonce = h.get("x-nonce") ?? undefined;
  if (dash.style === "pulse") {
    // Inside the numbers' boundary the first-run pieces are already on the page above, so the fallback leaves them out.
    const view = await pulseView(user, dash.canSwitch, setup, nonce, () => classicView(user, dash.canSwitch, searchParams?.recapAt, setup, nonce, false)).catch(() => null);
    // R1288: in the installed app, a pull from the top refreshes Home in place (components/home/HomeRefresh.tsx).
    if (view) return <HomeRefresh>{view}</HomeRefresh>;
  }
  return <HomeRefresh>{await classicView(user, dash.canSwitch, searchParams?.recapAt, setup, nonce, true)}</HomeRefresh>;
}

/** The classic Home. `firstRun` false: drawn inside the pulse view, which already shows the checklist and greetings. */
async function classicView(user: HomeUser, canSwitch: boolean, recapAtParam: string | undefined, setup: Setup, nonce: string | undefined, firstRun: boolean) {
  // One parallel wave: every query below is independent, so the page pays one database round trip, not four.
  // Pulse only needs the connections and the published count, so it chains on those two instead of waiting for all.
  const liveP = connectedPlatforms(user.id);
  const publishedP = db.post.count({ where: { userId: user.id, status: { in: ["published", "partial"] } } });
  const meP = db.user.findUnique({ where: { id: user.id }, select: { postingGoal: true, weeklyReport: true } });
  // 1096: the Monday email is a plan perk; don't offer a switch that would never send.
  const digestP = user.actor ? Promise.resolve(false) : entitlements(user.id).then((e) => hasPerk(e, "weekly-digest")).catch(() => true);
  const recapHidden = (await cookies()).get(RECAP_COOKIE)?.value;
  // Dev only: preview the Monday card on any day (?recapAt=2026-10-19T05:00:00Z).
  const recapAt = process.env.NODE_ENV !== "production" && recapAtParam ? new Date(recapAtParam) : new Date();
  // 1037: the picked profile (or a member's accounts) narrows the drafts and the next post too.
  const [profiles, scope, badges] = await Promise.all([listProfiles(user.id, user.scope), postFilter(user), trustBadges(user.id)]);
  const [, drafts, next, live, welcome, published, ret, pulse, recap, founding, saved, storage, onboarding, intel] = await Promise.all([
    loadKeys(),
    db.post.findMany({ where: { userId: user.id, status: "draft", archivedAt: null, ...scope.where }, include: { targets: true, media: true }, orderBy: { updatedAt: "desc" }, take: 3 }),
    db.post.findFirst({ where: { userId: user.id, status: "scheduled", scheduledAt: { gte: new Date() }, ...scope.where }, include: { targets: true, media: true }, orderBy: { scheduledAt: "asc" } }),
    liveP,
    firstRun ? soft(welcomeOffer(user), CARD_MS, null, "home welcome") : null,
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
    user.actor || !firstRun ? null : soft(myFounding(user.id), CARD_MS, null, "home founding"),
    soft(savedTime(user.id, Date.now(), scope.where), CARD_MS, null, "home saved"),
    soft(storageUsage(user.id), CARD_MS, null, "home storage"),
    // Phase 2: the guided setup, saved on the account and merged with the studio's own data (lib/onboarding.ts)
    firstRun ? soft(onboardingFor(user), CARD_MS, null, "home onboarding") : null,
    // R1325: the Intelligence pulse (baselines, one personal recommendation, the clipper queue); owners only, never fatal.
    // Inside the pulse view (firstRun false) the page already renders the card once (R1328 review).
    user.actor || !firstRun ? null : soft(intelligencePulse(user.id), CARD_MS, null, "home intelligence"),
  ]);
  const started = Object.values(live).some(Boolean) || published > 0;
  const steps = ret?.steps ?? [];
  const recycle = ret?.recycle ?? [];
  // Ideas fill a whole row when nothing sits beside them; with no steps they pair with the streak card.
  const ideasWide = ret ? steps.length > 0 && recycle.length === 0 : true;
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
      {firstRun && <PageFresh renderedAt={Date.now()} maxAge={90_000} />}
      {canSwitch && <div className="page-frame flex justify-end pt-4"><DashboardSwitch current="classic" /></div>}
      <HomeHero firstName={user.name.split(" ")[0]} />
      <HomeContentMark nonce={nonce} />
      {profiles.length >= 2 ? (
        <ProfileSwitcher profiles={profiles} activeId={scope.active?.id ?? null}>
          <TrustBadges b={badges} className="mt-3" />
        </ProfileSwitcher>
      ) : (
        (badges.verifiedManager || badges.foundingNo) && <div className="page-frame pb-4"><TrustBadges b={badges} /></div>
      )}
      {onboarding && <OnboardingFlow initial={onboarding} auto />}
      {onboarding && <SetupChecklist onboarding={onboarding} hidden={setup.hidden} deviceOpen={setup.deviceOpen} />}
      {promo ? (
        <FoundingWelcome promo={promo} />
      ) : (
        welcome && <WelcomeSubscribe firstName={user.name.split(" ")[0]} offer={welcome.offer} freeLimit={welcome.freeLimit} freePeriod={welcome.freePeriod} foundingFull={founding?.kind === "full" ? founding.limit : null} trial={welcome.trial} />
      )}
      {(pulse || recap || (saved && saved.posts > 0) || intel) && (
        <div className="page-frame grid grid-cols-[minmax(0,1fr)] gap-4 pb-4">
          {recap && <WeekRecap r={recap} canEmail={!user.actor && (await digestP)} />}
          {pulse && <SendingNow items={pulse.sending} />}
          {pulse && <WeekPulse p={pulse} />}
          {intel && <IntelligencePulseCard p={intel} />}
          {saved && <TimeSavedCard t={saved} />}
        </div>
      )}
      {started && (
        // One 12-column bento: next steps beside the streak, ideas beside recycling. Spans adapt to what's there.
        <div className="page-frame grid grid-cols-[minmax(0,1fr)] gap-4 pb-10 md:grid-cols-12">
          {steps.length > 0 && <div className="grid min-w-0 md:col-span-7"><NextSteps steps={steps} /></div>}
          {ret && <div className="grid min-w-0 md:col-span-5"><GoalRing goal={ret.goal} scheduled={ret.scheduledThisWeek} canEdit={!user.actor} /></div>}
          <div className={cn("grid min-w-0", ideasWide ? "md:col-span-12" : "md:col-span-7")}><IdeaBank wide={ideasWide} /></div>
          {recycle.length > 0 && <div className={cn("grid min-w-0", ret && steps.length === 0 ? "md:col-span-12" : "md:col-span-5")}><RecycleCard posts={recycle} /></div>}
        </div>
      )}
      {storage && (
        <div className="page-frame pb-4">
          <StorageCard s={storage} planName={storage.planName} canUpgrade={!user.actor && storage.planSlug !== "pro-manager"} />
        </div>
      )}
      {(dv.length > 0 || nv) && (
        <section aria-label="Pick up where you left off" className="page-frame grid grid-cols-[minmax(0,1fr)] gap-4 pb-20 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
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
