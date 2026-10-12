import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { UserProvider } from "@/components/shell/UserContext";
import { ToastProvider } from "@/components/shared/Toast";
import { MobileNav, MobileTopBar, Sidebar } from "@/components/shell/Nav";
import { Tour } from "@/components/onboarding/Tour";
import { touchActivity } from "@/lib/activity";
import { liveNow } from "@/lib/social/registry";
import { LivePlatformsProvider } from "@/components/shell/LivePlatforms";
import { WorkspaceBar } from "@/components/shell/WorkspaceBar";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const live = await liveNow();
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
          <MobileTopBar />
          <main id="main" className="relative min-h-dvh pb-28 lg:pb-0">
            {children}
          </main>
        </div>
      </div>
      <MobileNav />
      <Tour />
      </ToastProvider>
      </LivePlatformsProvider>
    </UserProvider>
  );
}
