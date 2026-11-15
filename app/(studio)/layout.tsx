import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { currentSessionId, getCurrentUser } from "@/lib/auth";
import { ACCT_COOKIE } from "@/lib/profiles";
import { UserProvider } from "@/components/shell/UserContext";
import { AvatarCursor } from "@/components/shell/AvatarCursor";
import { ToastProvider } from "@/components/shared/Toast";
import { MobileNav, MobileTopBar, Sidebar } from "@/components/shell/Nav";
import { Tour } from "@/components/onboarding/Tour";
import { PageGuide } from "@/components/onboarding/PageGuide";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { touchAll } from "@/lib/activity";
import { studioSettings } from "@/lib/startup-config";
import { loadKeys } from "@/lib/social/keys";
import { timingContent } from "@/lib/server-timing";
import { LivePlatformsProvider } from "@/components/shell/LivePlatforms";
import { WorkspaceBar } from "@/components/shell/WorkspaceBar";
import { joinedBeforeMaintenance } from "@/lib/maintenance";
import { Countdown } from "@/components/maintenance/Countdown";
import { WhatsNew } from "@/components/shell/WhatsNew";
import { SendingPill } from "@/components/shell/SendingPill";
import { PrivacyNotice } from "@/components/shared/PrivacyNotice";
import { UpgradeDialog } from "@/components/shared/UpgradeDialog";
import { AppEffects, AppMoreSheet, AppNavBar, AppTabBar } from "@/components/shell/AppChrome";
import { NativeBridge } from "@/components/shell/NativeBridge";
import { PushBridge } from "@/components/shell/PushBridge";
import { WarmUp } from "@/components/shell/WarmUp";
import { PerfBeacon } from "@/components/shell/PerfBeacon";
import { InstallPrompt } from "@/components/shell/InstallPrompt";
import { normalizeInstall } from "@/lib/pwa-core";
import { PwaWelcome } from "@/components/shell/PwaWelcome";
import { normalizeWelcome } from "@/lib/pwa-welcome";
import { PromoSheet } from "@/components/promo/PromoSheet";
import { PostHogIdentify } from "@/components/analytics/PostHogIdentify";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const t0 = performance.now();
  // Perf (startup): the only per-person read that may hold the first byte.
  const user = await getCurrentUser();
  const tUser = performance.now();
  // Signed cookie the database refuses: clear it on the way to sign-in, or middleware bounces /login back here (1042).
  if (!user) redirect(`/api/auth/expired?next=${encodeURIComponent((await headers()).get("x-path") ?? "/home")}`);
  // Site-wide admin settings (live platforms, maintenance, the notice, install and welcome cards) come from the shared
  // cache (lib/startup-config.ts), expired the moment an admin saves one, so a cold instance does not wait on them.
  const [{ live, site, notice, install, welcome }, h, jar, sid] = await Promise.all([
    studioSettings(),
    headers(),
    cookies(),
    currentSessionId().catch(() => null),
    // Platform app keys (Admin > Social platforms) into this instance's snapshot, so every studio page can read
    // creds() as before; a shared-cache hit above would otherwise skip it. 15 s cached, runs alongside the others.
    loadKeys().catch(() => null),
  ]);
  const tCfg = performance.now();
  const welcomeCfg = normalizeWelcome(welcome);
  // Maintenance: members who joined before it started carry on; anyone newer waits on the maintenance page.
  if (site.maintenance && !joinedBeforeMaintenance({ createdAt: user.joinedAt }, site.since)) redirect("/maintenance?preview");
  // Daily active, network place (1053), online now (1037) and the session's last active (1080): after the page is
  // sent, never during the render. cookies() and headers() are off limits inside after(), so they are read above.
  const actorId = user.actor?.id ?? user.id;
  const seen = new Headers(h);
  after(() => touchAll({ userId: user.id, actorId, sid, header: (n) => seen.get(n) }));
  return (
    <UserProvider user={{ id: user.id, name: user.name, email: user.email, avatar: user.avatar, timezone: user.timezone, workspace: user.actor ? { ownerName: user.name, role: user.role === "manager" ? "manager" : "editor", me: { name: user.actor.name, email: user.actor.email } } : null, view: jar.get(ACCT_COOKIE)?.value ?? null }}>
      {/* Perf: how long this layout waited on the account and on the settings, read by the perf collector. No personal data. */}
      <meta name="x-timing" content={timingContent({ user: tUser - t0, cfg: tCfg - tUser })} />
      <LivePlatformsProvider value={live}>
      <ToastProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
        Skip to main content
      </a>
      <div className="flex min-h-dvh">
        <Sidebar />
        {/* A column that is exactly the screen when the page is short: no empty scroll below the content (1053). */}
        <div className="flex min-h-dvh min-w-0 flex-1 flex-col overflow-x-clip">
          <WorkspaceBar />
          {site.maintenance && site.endsAt && (
            <div className="mtop-pre border-b border-border/60 bg-[hsl(var(--lime)/0.14)] px-4 py-2">
              <Countdown endsAt={site.endsAt} since={site.since} variant="bar" />
            </div>
          )}
          <MobileTopBar />
          <AppNavBar />
          {/* Room for the floating tab bar (62px over the home indicator's safe area, 1105) and 26px of air, so the
              last card always scrolls clear of it. It was 11rem plus each page's own. Phase 4: a page without the
              tab bar (MobileNav renders data-tabbar-off on /create) keeps only the safe area. */}
          <main id="main" tabIndex={-1} className="mmain relative flex-1 outline-none pb-[calc(env(safe-area-inset-bottom)+88px)] max-lg:[body:has([data-tabbar-off])_&]:pb-[env(safe-area-inset-bottom)] lg:pb-0">
            {children}
          </main>
        </div>
      </div>
      <MobileNav />
      <AppTabBar />
      <AppMoreSheet />
      <AppEffects />
      <NativeBridge />
      <PushBridge owner={!user.actor} />
      {/* Before the other popups: it decides in a layout effect, so they already see it pending (1100). Off in
          Admin = not rendered at all, so a head-script flag has nothing to show and nothing waits on it. */}
      {welcomeCfg.enabled && <PwaWelcome config={welcomeCfg} />}
      <SendingPill />
      <PrivacyNotice />
      <UpgradeDialog />
      <Tour />
      <PageGuide />
      <CommandPalette />
      <WhatsNew notice={notice} userId={user.actor?.id ?? user.id} joinedAt={new Date(user.joinedAt).toISOString()} />
      {/* 1122: the promo offer, once per fresh app entry; it fetches its own offer, so this layout stays fast. */}
      {!user.actor && <PromoSheet />}
      <AvatarCursor />
      <PostHogIdentify id={user.actor?.id ?? user.id} joinedAt={new Date(user.joinedAt).toISOString()} />
      {/* 1114: preloads every primary tab in the background; the server's clock lets pages judge their age. */}
      <WarmUp serverNow={Date.now()} />
      {/* Perf: one startup timing beacon per load (no PII); read-out in Admin > Startup speed. */}
      <PerfBeacon />
      <InstallPrompt config={normalizeInstall(install)} />
      </ToastProvider>
      </LivePlatformsProvider>
    </UserProvider>
  );
}
