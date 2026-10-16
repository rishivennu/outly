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
import { entitlements } from "@/lib/billing/entitlements";
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
import { homePulse } from "@/lib/retention/pulse";
import { isPlatform } from "@/lib/domain";
import { cn } from "@/lib/utils";

const NEW_FOR_DAYS = 14;

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
  if (!pick) return { freeLimit: ent.postLimit, offer: null };
  const visitor = visitorCurrency((pick.currency as never) ?? "INR");
  const lp = localPrice(pick, visitor.currency);
  const offer: WelcomeOffer = { slug: pick.slug, name: pick.name, price: formatMoney(lp.priceMinor, lp.currency), interval: pick.interval === "year" ? "year" : "month", features: pick.features.slice(0, 3), postLimit: pick.postLimit, aiCaptions: pick.aiCaptions };
  return { freeLimit: ent.postLimit, offer };
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

export default async function HomePage() {
  const user = (await getCurrentUser())!;
  await loadKeys();
  const me = await db.user.findUnique({ where: { id: user.id }, select: { postingGoal: true } });
  const [drafts, next, live, welcome, published, ret] = await Promise.all([
    db.post.findMany({ where: { userId: user.id, status: "draft" }, include: { targets: true, media: true }, orderBy: { updatedAt: "desc" }, take: 3 }),
    db.post.findFirst({ where: { userId: user.id, status: "scheduled", scheduledAt: { gte: new Date() } }, include: { targets: true, media: true }, orderBy: { scheduledAt: "asc" } }),
    connectedPlatforms(user.id),
    welcomeOffer(user).catch(() => null),
    db.post.count({ where: { userId: user.id, status: { in: ["published", "partial"] } } }),
    homeRetention({ id: user.id, postingGoal: me?.postingGoal ?? 3, timezone: user.timezone }).catch((e) => {
      console.error("[home] retention", e);
      return null;
    }),
  ]);
  const started = Object.values(live).some(Boolean) || published > 0;
  const pulse = started
    ? await homePulse({ id: user.id, timezone: user.timezone }, Object.keys(live).filter((k) => live[k as Platform] && isPlatform(k)) as Platform[]).catch((e) => {
        console.error("[home] pulse", e);
        return null;
      })
    : null;
  const steps = ret?.steps ?? [];
  const recycle = ret?.recycle ?? [];
  // Ideas fill a whole row when nothing sits beside them; with no steps they pair with the streak card.
  const ideasWide = ret ? steps.length > 0 && recycle.length === 0 : true;
  const setup = {
    connected: { instagram: !!live.instagram, youtube: !!live.youtube },
    instagram: { oauth: hasCredentials("instagram"), token: canConnectWithToken("instagram") },
    youtube: { oauth: hasCredentials("youtube") },
  };
  // one tick, so every signed URL on the page goes out as a single batch
  const [dv, nv] = await Promise.all([Promise.all(drafts.map(postView)), next ? postView(next) : null]);
  const when = nv?.scheduledAt
    ? new Intl.DateTimeFormat("en-US", { timeZone: user.timezone, weekday: "long", hour: "numeric", minute: "2-digit" }).format(new Date(nv.scheduledAt))
    : null;

  return (
    <div className="relative overflow-hidden">
      <HomeHero firstName={user.name.split(" ")[0]} />
      <SetupChecklist state={setup} />
      {welcome && <WelcomeSubscribe firstName={user.name.split(" ")[0]} offer={welcome.offer} freeLimit={welcome.freeLimit} />}
      {pulse && (
        <div className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-4 px-5 pb-4 sm:px-10">
          <SendingNow items={pulse.sending} />
          <WeekPulse p={pulse} />
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
