import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { UserProvider } from "@/components/shell/UserContext";
import { AvatarCursor } from "@/components/shell/AvatarCursor";
import { Watermark } from "@/components/shared/Watermark";
import { createHash } from "node:crypto";
import { ToastProvider } from "@/components/shared/Toast";
import { MobileNav, MobileTopBar, Sidebar } from "@/components/shell/Nav";
import { Tour } from "@/components/onboarding/Tour";
import { touchActivity } from "@/lib/activity";
import { liveNow } from "@/lib/social/registry";
import { LivePlatformsProvider } from "@/components/shell/LivePlatforms";
import { WorkspaceBar } from "@/components/shell/WorkspaceBar";
import { siteStatus, joinedBeforeMaintenance } from "@/lib/site";
import { Countdown } from "@/components/maintenance/Countdown";
import { getConfig } from "@/lib/settings";
import { WhatsNew } from "@/components/shell/WhatsNew";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [live, site, notice] = await Promise.all([liveNow(), siteStatus(), getConfig("updates")]);
  // Maintenance: members who joined before it started carry on; anyone newer waits on the maintenance page.
  if (site.maintenance && !joinedBeforeMaintenance({ createdAt: user.joinedAt }, site.since)) redirect("/maintenance?preview");
  void touchActivity(user.id); // daily-active tracking for the admin console; never blocks or throws
  return (
    <UserProvider user={{ id: user.id, name: user.name, email: user.email, avatar: user.avatar, timezone: user.timezone, workspace: user.actor ? { ownerName: user.name, role: user.role === "manager" ? "manager" : "editor", me: { name: user.actor.name, email: user.actor.email } } : null }}>
      <LivePlatformsProvider value={live}>
      <ToastProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
        Skip to main content
      </a>
      <div className="flex min-h-dvh">
        <Sidebar />
        <div className="min-w-0 flex-1">
          <WorkspaceBar />
          {site.maintenance && site.endsAt && (
            <div className="border-b border-border/60 bg-[hsl(var(--lime)/0.14)] px-4 py-2">
              <Countdown endsAt={site.endsAt} since={site.since} variant="bar" />
            </div>
          )}
          <MobileTopBar />
          <main id="main" className="relative min-h-dvh pb-28 lg:pb-0">
            {children}
          </main>
        </div>
      </div>
      <MobileNav />
      <Tour />
      <WhatsNew notice={notice} userId={user.actor?.id ?? user.id} joinedAt={new Date(user.joinedAt).toISOString()} />
      <AvatarCursor />
      <Watermark tag={createHash("sha256").update(user.id).digest("hex").slice(0, 10).toUpperCase()} />
      </ToastProvider>
      </LivePlatformsProvider>
    </UserProvider>
  );
}
