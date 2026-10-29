import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { UserProvider } from "@/components/shell/UserContext";
import { AvatarCursor } from "@/components/shell/AvatarCursor";
import { ToastProvider } from "@/components/shared/Toast";
import { MobileNav, MobileTopBar, Sidebar } from "@/components/shell/Nav";
import { Tour } from "@/components/onboarding/Tour";
import { PageGuide } from "@/components/onboarding/PageGuide";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { touchActivity } from "@/lib/activity";
import { touchPresence } from "@/lib/presence";
import { liveNow } from "@/lib/social/registry";
import { LivePlatformsProvider } from "@/components/shell/LivePlatforms";
import { WorkspaceBar } from "@/components/shell/WorkspaceBar";
import { siteStatus, joinedBeforeMaintenance } from "@/lib/site";
import { Countdown } from "@/components/maintenance/Countdown";
import { getConfig } from "@/lib/settings";
import { WhatsNew } from "@/components/shell/WhatsNew";
import { SendingPill } from "@/components/shell/SendingPill";
import { PrivacyNotice } from "@/components/shared/PrivacyNotice";
import { UpgradeDialog } from "@/components/shared/UpgradeDialog";
import { AppEffects, AppMoreSheet, AppNavBar, AppTabBar } from "@/components/shell/AppChrome";
import { NativeBridge } from "@/components/shell/NativeBridge";
import { WarmUp } from "@/components/shell/WarmUp";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  // Signed cookie the database refuses: clear it on the way to sign-in, or middleware bounces /login back here (1042).
  if (!user) redirect(`/api/auth/expired?next=${encodeURIComponent(headers().get("x-path") ?? "/home")}`);
  const [live, site, notice] = await Promise.all([liveNow(), siteStatus(), getConfig("updates")]);
  // Maintenance: members who joined before it started carry on; anyone newer waits on the maintenance page.
  if (site.maintenance && !joinedBeforeMaintenance({ createdAt: user.joinedAt }, site.since)) redirect("/maintenance?preview");
  void touchActivity(user.id); // daily-active tracking for the admin console; never blocks or throws
  void touchPresence(user.actor?.id ?? user.id); // online now (1037); the LiveCount poll keeps it fresh
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
          <AppNavBar />
          <main id="main" className="relative min-h-dvh pb-[calc(env(safe-area-inset-bottom)+11rem)] lg:pb-0">
            {children}
          </main>
        </div>
      </div>
      <MobileNav />
      <AppTabBar />
      <AppMoreSheet />
      <AppEffects />
      <NativeBridge />
      <SendingPill />
      <PrivacyNotice />
      <UpgradeDialog />
      <Tour />
      <PageGuide />
      <CommandPalette />
      <WhatsNew notice={notice} userId={user.actor?.id ?? user.id} joinedAt={new Date(user.joinedAt).toISOString()} />
      <AvatarCursor />
      <WarmUp />
      </ToastProvider>
      </LivePlatformsProvider>
    </UserProvider>
  );
}
