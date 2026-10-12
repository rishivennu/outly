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

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

export default async function HomePage() {
  const user = (await getCurrentUser())!;
  await loadKeys();
  const [drafts, next, live] = await Promise.all([
    db.post.findMany({ where: { userId: user.id, status: "draft" }, include: { targets: true, media: true }, orderBy: { updatedAt: "desc" }, take: 3 }),
    db.post.findFirst({ where: { userId: user.id, status: "scheduled", scheduledAt: { gte: new Date() } }, include: { targets: true, media: true }, orderBy: { scheduledAt: "asc" } }),
    connectedPlatforms(user.id),
  ]);
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
                      <ArrowUpRight className="h-4 w-4 text-muted-foreground transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
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
