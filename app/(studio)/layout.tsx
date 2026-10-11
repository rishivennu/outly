import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { UserProvider } from "@/components/shell/UserContext";
import { ToastProvider } from "@/components/shared/Toast";
import { MobileNav, MobileTopBar, Sidebar } from "@/components/shell/Nav";
import { Tour } from "@/components/onboarding/Tour";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <UserProvider user={{ id: user.id, name: user.name, email: user.email, avatar: user.avatar, timezone: user.timezone }}>
      <ToastProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
        Skip to main content
      </a>
      <div className="flex min-h-dvh">
        <Sidebar />
        <div className="min-w-0 flex-1">
          <MobileTopBar />
          <main id="main" className="relative min-h-dvh pb-28 lg:pb-0">
            {children}
          </main>
        </div>
      </div>
      <MobileNav />
      <Tour />
      </ToastProvider>
    </UserProvider>
  );
}
