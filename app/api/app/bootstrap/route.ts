import { realUserId } from "@/lib/auth";
import { billingUsage, planLimits } from "@/lib/billing/plan-view";
import { dashboardFor } from "@/lib/dashboard-style";
import { db } from "@/lib/db";
import { json, route } from "@/lib/http";
import { meBody } from "@/lib/me";
import { nativeClient } from "@/lib/native-client";
import { parseUiPrefs } from "@/lib/nav-config";
import { navFor } from "@/lib/nav-style";
import { activeProfile, listProfiles } from "@/lib/profiles";
import { memberships } from "@/lib/team/service";
import { studioSettings } from "@/lib/startup-config";

export const dynamic = "force-dynamic";

/**
 * R1294: everything the app needs at start in one call, each part read by the same lib function its own route uses
 * (/api/me, /api/plan/limits, /api/billing/usage, /api/team, /api/profiles, /api/me/nav), so the answers never drift.
 */
export const GET = route(async (req, { user }) => {
  const me = realUserId(user);
  const [limits, usage, files, seats, profiles, nav, dash, studio] = await Promise.all([
    planLimits(user.id),
    billingUsage(user.id),
    db.media.count({ where: { userId: user.id, deletedAt: null, status: { notIn: ["failed", "uploading"] } } }),
    memberships(me),
    listProfiles(user.id, user.scope),
    navFor(),
    dashboardFor(),
    // R-APP6: the admin "What changed" notice and the welcome card copy, the same shared snapshot the studio layout reads.
    studioSettings(),
  ]);
  const active = await activeProfile(user, profiles);
  return json(
    {
      ...meBody(user, !!nativeClient(req)),
      plan: { id: limits.plan.slug, name: limits.plan.name, limits, usage },
      storage: { usedBytes: usage.storage.usedBytes, limitBytes: usage.storage.limitBytes, files },
      team: {
        workspaces: [
          { id: me, name: user.actor?.name ?? user.name, role: "owner", isActive: !user.actor },
          ...seats.map((s) => ({ id: s.ownerId, name: s.ownerName, role: s.role, isActive: !!user.actor && s.ownerId === user.id })),
        ],
      },
      profiles,
      activeProfileId: active?.id ?? null,
      nav: { style: nav.style, locked: !nav.canSwitch, intro: { eligible: nav.intro, saved: parseUiPrefs(user.uiPrefs).navIntro ?? null } },
      dashboard: { style: dash.style, locked: !dash.canSwitch },
      updates: studio.notice,
      welcome: studio.welcome,
      serverTime: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
});
